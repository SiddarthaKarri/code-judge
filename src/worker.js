const Redis = require('ioredis');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

const redis = new Redis(process.env.REDIS_URL, {
    tls: process.env.REDIS_URL.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined
});

redis.on('error', (err) => {
    console.error('Redis connection error:', err.message);
});

const BACKEND_URL = process.env.BACKEND_URL;
const PISTON_API_URL = process.env.PISTON_API_URL || 'https://emkc.org/api/v2/piston/execute';

console.log('Judge Worker started (Online Mode - Piston API), listening for submissions...');

const LANGUAGE_MAP = {
    'javascript': { language: 'javascript', version: '18.15.0' },
    'python': { language: 'python', version: '3.10.0' },
    'java': { language: 'java', version: '15.0.2' },
    'cpp': { language: 'c++', version: '10.2.0' }
};

async function processSubmission(submission) {
    const { id, code, language, problem, testCases, mode } = submission;
    console.log(`Processing submission ${id} for problem ${problem.title} [Mode: ${mode}]`);

    let verdict = 'Accepted';
    let results = []; // Array to store detailed results

    try {
        const langConfig = LANGUAGE_MAP[language.toLowerCase()];
        if (!langConfig) {
            throw new Error(`Unsupported language: ${language}`);
        }

        // Filter test cases based on mode
        let targetTestCases = testCases;
        if (mode === 'run') {
            targetTestCases = testCases.filter(tc => tc.isSample);
            if (targetTestCases.length === 0) {
                targetTestCases = testCases.slice(0, 2);
            }
        }

        if (!targetTestCases || targetTestCases.length === 0) {
            console.log('No test cases found, defaulting to Accepted');
        }

        for (let i = 0; i < targetTestCases.length; i++) {
            const testCase = targetTestCases[i];
            console.log(`Running Test Case ${i + 1}/${targetTestCases.length} [isSample: ${testCase.isSample}]`);

            // Prepare payload for Piston
            const payload = {
                language: langConfig.language,
                version: langConfig.version,
                files: [
                    {
                        content: code
                    }
                ],
                stdin: testCase.input,
                args: [],
                compile_timeout: 10000,
                run_timeout: 3000,
                compile_memory_limit: -1,
                run_memory_limit: -1
            };

            // Execute with retry logic for 429
            let response;
            let retries = 3;
            while (retries > 0) {
                try {
                    response = await axios.post(PISTON_API_URL, payload);
                    break;
                } catch (err) {
                    if (err.response && err.response.status === 429) {
                        console.log(`Rate limited (429). Retrying in 2s... (${retries} left)`);
                        await new Promise(r => setTimeout(r, 2000));
                        retries--;
                    } else {
                        throw err;
                    }
                }
            }
            if (!response) throw new Error('Failed to execute code after retries (Rate Limit)');
            const result = response.data;

            let caseStatus = 'Accepted';
            let actualOutput = '';
            let error = null;

            // Check for runtime/compile errors
            if (result.run && result.run.code !== 0) {
                caseStatus = 'Runtime Error';
                error = `Exit Code: ${result.run.code}\nError: ${result.run.stderr}`;
                verdict = 'Runtime Error';
            } else if (result.compile && result.compile.code !== 0) {
                caseStatus = 'Compilation Error';
                error = result.compile.output;
                verdict = 'Compilation Error';
            } else {
                // Capture output (prefer stdout if output is empty/weird)
                actualOutput = (result.run.output || result.run.stdout || '').trim();
                if (!actualOutput) actualOutput = '(No output)'; // Explicitly show no output
                const expectedOutput = testCase.output.trim();

                if (actualOutput !== expectedOutput) {
                    caseStatus = 'Wrong Answer';
                    if (verdict === 'Accepted') verdict = 'Wrong Answer';
                }
            }

            // Mask details for hidden test cases in 'submit' mode
            let displayInput = testCase.input;
            let displayExpected = testCase.output;
            let displayActual = actualOutput;
            let displayError = error;

            if (mode === 'submit' && !testCase.isSample) {
                displayInput = 'Hidden';
                displayExpected = 'Hidden';
                displayActual = 'Hidden';
                if (displayError) displayError = 'Hidden';
            }

            results.push({
                id: i + 1,
                status: caseStatus,
                input: displayInput,
                expectedOutput: displayExpected,
                actualOutput: displayActual,
                error: displayError,
                isSample: testCase.isSample
            });

            // If compilation error, stop immediately as it affects all cases
            if (caseStatus === 'Compilation Error') break;
        }

        console.log(`Execution Result: ${verdict}`);

    } catch (err) {
        console.error('Execution error:', err.message);
        verdict = 'Internal Error';
        results.push({ status: 'Internal Error', error: err.message });
    }

    // Send verdict back to backend
    try {
        await axios.post(`${BACKEND_URL}/judge/callback`, {
            submissionId: id,
            status: verdict,
            output: results // Send structured JSON
        });
        console.log(`Verdict sent: ${verdict}`);
    } catch (err) {
        console.error('Failed to send callback:', err.message);
    }
}

async function main() {
    while (true) {
        try {
            const response = await redis.brpop('submissionQueue', 0);
            if (response) {
                const submission = JSON.parse(response[1]);
                await processSubmission(submission);
            }
        } catch (err) {
            console.error('Redis error:', err);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

main();
