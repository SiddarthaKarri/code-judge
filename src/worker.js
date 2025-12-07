// --------------------------------------------------------
// Ultra-Optimized Judge Worker (Fastest Version)
// --------------------------------------------------------

const Redis = require("ioredis");
const axios = require("axios");
const dotenv = require("dotenv");

dotenv.config();

// ------------------ Redis ------------------
const redis = new Redis(process.env.REDIS_URL, {
    tls: process.env.REDIS_URL.startsWith("rediss://")
        ? { rejectUnauthorized: false }
        : undefined
});

redis.on("error", (err) => {
    console.error("Redis error:", err.message);
});

// ------------------ Config ------------------
const BACKEND_URL = process.env.BACKEND_URL;
const PISTON_API_URL = "https://sidcj-production.up.railway.app/api/v2/piston/execute";

console.log("🚀 Optimized Worker Started");
console.log("Using Judge API:", PISTON_API_URL);

// ------------------ Language Mapping ------------------
const LANGUAGE_MAP = {
    javascript: { language: "javascript", version: "18.15.0" },
    python: { language: "python", version: "3.10.0" },
    java: { language: "java", version: "15.0.2" },
    cpp: { language: "c++", version: "10.2.0" }
};

// ------------------ Testcase Runner ------------------
async function runTestCase(testCase, index, code, langConfig) {
    console.log(`⚡ Running Test Case ${index + 1} (isSample=${testCase.isSample})`);

    const payload = {
        language: langConfig.language,
        version: langConfig.version,
        files: [
            {
                name:
                    langConfig.language === "c++"
                        ? "source.cpp"
                        : langConfig.language === "java"
                        ? "Main.java"
                        : langConfig.language === "python"
                        ? "main.py"
                        : "main.js",
                content: code
            }
        ],
        stdin: testCase.input,
        args: [],
        compile_timeout: 6000,
        run_timeout: 2500,
        compile_memory_limit: -1,
        run_memory_limit: -1
    };

    try {
        const res = await axios.post(PISTON_API_URL, payload, {
            timeout: 8000
        });

        const result = res.data;

        let verdict = "Accepted";
        let actualOutput = "";
        let error = null;

        if (result.compile && result.compile.code !== 0) {
            verdict = "Compilation Error";
            error = result.compile.stderr || result.compile.output;
        } else if (result.run && result.run.code !== 0) {
            verdict = "Runtime Error";
            error = result.run.stderr;
        } else {
            actualOutput =
                (result.run.output || result.run.stdout || "").trim();

            if (actualOutput !== testCase.output.trim()) {
                verdict = "Wrong Answer";
            }
        }

        return {
            id: index + 1,
            verdict,
            input: testCase.input,
            expectedOutput: testCase.output,
            actualOutput,
            error,
            isSample: testCase.isSample
        };
    } catch (err) {
        return {
            id: index + 1,
            verdict: "Internal Error",
            error: err.message
        };
    }
}

// ------------------ Submission Processor ------------------
async function processSubmission(submission) {
    const { id, code, language, problem, testCases, mode } = submission;

    console.log(`\n🚀 Processing ${id} | Problem: ${problem.title} | Mode: ${mode}`);

    let langConfig = LANGUAGE_MAP[language.toLowerCase()];
    if (!langConfig) langConfig = LANGUAGE_MAP["cpp"];

    // Select sample testcases for "run"
    let selectedCases = testCases;
    if (mode === "run") {
        selectedCases = testCases.filter((t) => t.isSample);
        if (selectedCases.length === 0) {
            selectedCases = testCases.slice(0, 2);
        }
    }

    // Run ALL testcases in PARALLEL (FASTEST)
    const results = await Promise.all(
        selectedCases.map((tc, i) => runTestCase(tc, i, code, langConfig))
    );

    // Determine final verdict in priority order
    let finalVerdict = "Accepted";
    for (const r of results) {
        if (r.verdict === "Compilation Error") {
            finalVerdict = "Compilation Error";
            break;
        }
        if (r.verdict === "Runtime Error" && finalVerdict === "Accepted") {
            finalVerdict = "Runtime Error";
        }
        if (r.verdict === "Wrong Answer" &&
            finalVerdict === "Accepted") {
            finalVerdict = "Wrong Answer";
        }
    }

    // Mask hidden testcases
    const masked = results.map((r) => {
        if (mode === "submit" && !r.isSample) {
            return {
                id: r.id,
                status: r.verdict,
                input: "Hidden",
                expectedOutput: "Hidden",
                actualOutput: "Hidden",
                error: r.error ? "Hidden" : null,
                isSample: false
            };
        }
        return {
            id: r.id,
            status: r.verdict,
            input: r.input,
            expectedOutput: r.expectedOutput,
            actualOutput: r.actualOutput,
            error: r.error,
            isSample: r.isSample
        };
    });

    // Send callback to backend
    try {
        await axios.post(`${BACKEND_URL}/api/judge/callback`, {
            submissionId: id,
            status: finalVerdict,
            output: masked
        });

        console.log(`🏁 Verdict Sent: ${finalVerdict}`);
    } catch (err) {
        console.error("Callback error:", err.message);
    }
}

// ------------------ Main Worker Loop ------------------
async function main() {
    while (true) {
        try {
            const response = await redis.brpop("submissionQueue", 0);
            const submission = JSON.parse(response[1]);
            await processSubmission(submission);
        } catch (err) {
            console.error("Worker loop error:", err.message);
        }
    }
}

main();