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
const PISTON_API_URL = 'https://sidcj-production.up.railway.app/api/v2/piston/execute' 
// || 'https://universally-electrodialitic-danette.ngrok-free.dev/api/v2/piston/execute' || process.env.PISTON_API_URL || 'https://emkc.org/api/v2/piston/execute';

console.log('Judge Worker started (Online Mode - Piston API), listening for submissions...');

const LANGUAGE_MAP = {
    'javascript': { language: 'javascript', version: '18.15.0' },
    'python': { language: 'python', version: '3.10.0' },
    'java': { language: 'java', version: '15.0.2' },
    'cpp': { language: 'cpp', version: '10.2.0' }
};

// Rate Limiter: Ensure max requests per second
const rateLimit = (intervalMs) => {
    const queue = [];
    let lastRequestTime = 0;
    let processing = false;

    const processQueue = async () => {
        if (processing) return;
        processing = true;

        while (queue.length > 0) {
            const now = Date.now();
            const timeSinceLast = now - lastRequestTime;

            if (timeSinceLast < intervalMs) {
                await new Promise(r => setTimeout(r, intervalMs - timeSinceLast));
            }

            const { fn, resolve, reject } = queue.shift();
            lastRequestTime = Date.now();

            // Execute without waiting for completion (fire and move to next delay)
            fn().then(resolve).catch(reject);
        }
        processing = false;
    };

    return (fn) => {
        return new Promise((resolve, reject) => {
            queue.push({ fn, resolve, reject });
            processQueue();
        });
    };
};

// Limit frequency to ~20 requests/sec (50ms gap) for private judge
const schedule = rateLimit(50);

async function runTestCase(testCase, i, total, content, langConfig) {
    console.log(`Running Test Case ${i + 1}/${total} [isSample: ${testCase.isSample}]`);

    const payload = {
        language: langConfig.language,
        // version: langConfig.version,
        files: [{
            name: langConfig.language === 'cpp' ? 'source.cpp' :
                langConfig.language === 'java' ? 'Main.java' :
                    langConfig.language === 'python' ? 'main.py' : 'main.js',
            content
        }],
        stdin: testCase.input,
        // args: [],
        compile_timeout: 10000,
        run_timeout: 3000,
        // compile_memory_limit: -1,
        // run_memory_limit: -1
    };

    let response;
    let retries = 3;
    while (retries > 0) {
        try {
            response = await axios.post(PISTON_API_URL, payload);
            break;
        } catch (err) {
            if (err.response && err.response.status === 429) {
                console.log(`Rate limited (429). Retrying in 2s... (${retries} left)`);
                await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));
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
    let verdict = 'Accepted';

    if (result.run && result.run.code !== 0) {
        caseStatus = 'Runtime Error';
        error = `Exit Code: ${result.run.code}\nError: ${result.run.stderr}`;
        verdict = 'Runtime Error';
    } else if (result.compile && result.compile.code !== 0) {
        caseStatus = 'Compilation Error';
        error = result.compile.output;
        verdict = 'Compilation Error';
    } else {
        actualOutput = (result.run.output || result.run.stdout || '').trim();
        if (!actualOutput) actualOutput = '(No output)';
        const expectedOutput = testCase.output.trim();

        if (actualOutput !== expectedOutput) {
            caseStatus = 'Wrong Answer';
            verdict = 'Wrong Answer';
        }
    }

    return {
        id: i + 1,
        status: caseStatus,
        verdict: verdict,
        input: testCase.input, // Will be masked later if needed
        output: testCase.output,
        actualOutput,
        error,
        isSample: testCase.isSample
    };
}

async function processSubmission(submission) {
    const { id, code, language, problem, testCases, mode } = submission;
    console.log(`Processing submission ${id} for problem ${problem.title} [Mode: ${mode}]`);

    let finalVerdict = 'Accepted';
    let results = [];

    try {
        const langConfig = LANGUAGE_MAP[language.toLowerCase()];
        if (!langConfig) throw new Error(`Unsupported language: ${language}`);

        let targetTestCases = testCases;
        if (mode === 'run') {
            targetTestCases = testCases.filter(tc => tc.isSample);
            if (targetTestCases.length === 0) targetTestCases = testCases.slice(0, 2);
        }

        if (!targetTestCases || targetTestCases.length === 0) {
            console.log('No test cases found, defaulting to Accepted');
        } else {
            // Run test cases with RATE LIMIT
            const promises = targetTestCases.map((tc, i) =>
                schedule(() => runTestCase(tc, i, targetTestCases.length, code, langConfig))
            );

            const rawResults = await Promise.all(promises);

            // Aggregate results
            for (const res of rawResults) {
                // Determine final verdict priority: Compilation Error > Runtime Error > Wrong Answer > Accepted
                if (res.verdict === 'Compilation Error') {
                    finalVerdict = 'Compilation Error';
                } else if (res.verdict === 'Runtime Error' && finalVerdict !== 'Compilation Error') {
                    finalVerdict = 'Runtime Error';
                } else if (res.verdict === 'Wrong Answer' && finalVerdict !== 'Compilation Error' && finalVerdict !== 'Runtime Error') {
                    finalVerdict = 'Wrong Answer';
                }

                // Mask details for hidden test cases
                let displayInput = res.input;
                let displayExpected = res.output;
                let displayActual = res.actualOutput;
                let displayError = res.error;

                if (mode === 'submit' && !res.isSample) {
                    displayInput = 'Hidden';
                    displayExpected = 'Hidden';
                    displayActual = 'Hidden';
                    if (displayError) displayError = 'Hidden';
                }

                results.push({
                    id: res.id,
                    status: res.status,
                    input: displayInput,
                    expectedOutput: displayExpected,
                    actualOutput: displayActual,
                    error: displayError,
                    isSample: res.isSample
                });
            }
        }

    } catch (err) {
        console.error('Execution error:', err.message);
        finalVerdict = 'Internal Error';
        results.push({ status: 'Internal Error', error: err.message });
    }

    // Send verdict back to backend
    try {
        await axios.post(`${BACKEND_URL}/api/judge/callback`, {
            submissionId: id,
            status: finalVerdict,
            output: results
        });
        console.log(`Verdict sent: ${finalVerdict}`);
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
