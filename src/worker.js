const Redis = require('ioredis');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

const redis = new Redis(process.env.REDIS_URL, {
    tls: process.env.REDIS_URL.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
    maxRetriesPerRequest: null
});

redis.on('error', (err) => {
    console.error('Redis connection error:', err.message);
});

// URLs will be fetched dynamically from Redis
const DEFAULT_BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';
const DEFAULT_PISTON_API_URL = 'https://code-engine-rtj4.onrender.com/api/v2/piston/execute';

async function getSystemUrls() {
    try {
        const backendUrl = await redis.get('config:backend_url');
        const pistonUrl = await redis.get('config:piston_api_url');
        return {
            backendUrl: backendUrl || DEFAULT_BACKEND_URL,
            pistonApiUrl: pistonUrl || DEFAULT_PISTON_API_URL
        };
    } catch (err) {
        console.error('Error fetching config from Redis:', err.message);
        return { backendUrl: DEFAULT_BACKEND_URL, pistonApiUrl: DEFAULT_PISTON_API_URL };
    }
}

console.log('Judge Worker started (Online Mode - Piston API), listening for submissions...');

// const LANGUAGE_MAP = {
//     'javascript': { language: 'javascript', version: '18.15.0' },
//     'python': { language: 'python', version: '3.10.0' },
//     'java': { language: 'java', version: '15.0.2' },
//     'cpp': { language: 'cpp', version: '10.2.0' }
// };

const LANGUAGE_MAP = {
    'javascript': { language: 'javascript' },
    'python': { language: 'python' },
    'java': { language: 'java' },
    'cpp': { language: 'cpp' }
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
    const { pistonApiUrl } = await getSystemUrls();
    console.log(`Running Test Case ${i + 1}/${total} [isSample: ${testCase.isSample}]`);

    const payload = {
        language: langConfig.language,
        // version: langConfig.version,
        files: [{
            name: langConfig.language === 'cpp' ? 'main.cpp' :
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
            response = await axios.post(pistonApiUrl, payload);
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
    const { backendUrl, pistonApiUrl } = await getSystemUrls();
    console.log(`Processing submission ${id} for problem ${problem.title} [Mode: ${mode}] using Backend: ${backendUrl}, Piston: ${pistonApiUrl}`);

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
            console.log(`Sending BATCH request for ${targetTestCases.length} test cases...`);

            // Prepare Batch Payload
            const payload = {
                language: langConfig.language,
                files: [{
                    name: langConfig.language === 'cpp' ? 'main.cpp' :
                        langConfig.language === 'java' ? 'Main.java' :
                            langConfig.language === 'python' ? 'main.py' : 'main.js',
                    content: code
                }],
                inputs: targetTestCases.map(tc => tc.input), // BATCH INPUTS
                compile_timeout: 10000,
                run_timeout: 3000
            };

            let response;
            let retries = 3;
            while (retries > 0) {
                try {
                    response = await axios.post(pistonApiUrl, payload);
                    break;
                } catch (err) {
                    if (err.response && (err.response.status === 429 || err.response.status >= 500)) {
                        console.log(`Judge Error (${err.response.status}). Retrying... (${retries})`);
                        await new Promise(r => setTimeout(r, 1500));
                        retries--;
                    } else {
                        throw err;
                    }
                }
            }
            if (!response) throw new Error('Failed to execute code after retries');

            const batchResults = response.data.results || [];

            // Map back to our structure
            for (let i = 0; i < targetTestCases.length; i++) {
                const tc = targetTestCases[i];
                const res = batchResults[i] || { stdout: '', stderr: 'Execution Missing', code: -1 };

                let caseStatus = 'Accepted';
                let verdict = 'Accepted';
                let actualOutput = '';
                let error = null;

                if (response.data.compile && response.data.compile.code !== 0) {
                    caseStatus = 'Compilation Error';
                    verdict = 'Compilation Error';
                    error = response.data.compile.stdout + response.data.compile.stderr;
                } else if (res.code !== 0) {
                    caseStatus = 'Runtime Error';
                    verdict = 'Runtime Error';
                    error = `Exit Code: ${res.code}\nError: ${res.stderr}`;
                } else {
                    actualOutput = (res.stdout || '').trim();
                    if (!actualOutput) actualOutput = '(No output)';
                    const expectedOutput = tc.output.trim();

                    if (actualOutput !== expectedOutput) {
                        caseStatus = 'Wrong Answer';
                        verdict = 'Wrong Answer';
                    }
                }

                // Update final verdict priority
                if (verdict === 'Compilation Error') {
                    finalVerdict = 'Compilation Error';
                } else if (verdict === 'Runtime Error' && finalVerdict !== 'Compilation Error') {
                    finalVerdict = 'Runtime Error';
                } else if (verdict === 'Wrong Answer' && finalVerdict !== 'Compilation Error' && finalVerdict !== 'Runtime Error') {
                    finalVerdict = 'Wrong Answer';
                }

                // Mask details for hidden test cases
                let displayInput = tc.input;
                let displayExpected = tc.output;
                let displayActual = actualOutput;
                let displayError = error;

                if (mode === 'submit' && !tc.isSample) {
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
                    isSample: tc.isSample
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
        let normalizedBackendUrl = backendUrl.endsWith('/') ? backendUrl.slice(0, -1) : backendUrl;
        if (normalizedBackendUrl.endsWith('/api')) {
            normalizedBackendUrl = normalizedBackendUrl.slice(0, -4);
        }

        await axios.post(`${normalizedBackendUrl}/api/judge/callback`, {
            submissionId: id,
            status: finalVerdict,
            output: results
        });
        console.log(`Verdict sent: ${finalVerdict}`);
    } catch (err) {
        console.error('Failed to send callback:', err.message);
    }
}

const { Worker } = require('bullmq');
const cluster = require('cluster');
const os = require('os');

if (cluster.isPrimary) {
    const numCPUs = os.cpus().length;
    console.log(`Primary ${process.pid} is running. Spawning ${numCPUs} workers for maximum parallelization...`);

    for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
        console.log(`Worker ${worker.process.pid} died. Respawning...`);
        cluster.fork();
    });
} else {
    console.log(`Judge Worker started (PID: ${process.pid}, Online Mode - Piston API), listening for submissions via BullMQ...`);

    const worker = new Worker('submissionQueue', async job => {
        // BullMQ automatically parses job.data back into an object
        await processSubmission(job.data);
    }, { connection: redis, concurrency: 5 }); // Process up to 5 jobs concurrently per CPU core

    worker.on('completed', job => {
        console.log(`[Worker ${process.pid}] Job ${job.id} completed!`);
    });

    worker.on('failed', (job, err) => {
        console.error(`[Worker ${process.pid}] Job ${job.id} failed with error ${err.message}`);
    });
}
