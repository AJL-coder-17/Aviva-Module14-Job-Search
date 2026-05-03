import dotenv from "dotenv";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import express from "express";
import axios from "axios";
import cors from "cors";
import FormData from "form-data";

const __dirname = dirname(fileURLToPath(import.meta.url));
// override: true so backend/.env wins over accidental shell exports (e.g. path-only COVER_LETTER_API_URL).
dotenv.config({ path: join(__dirname, ".env"), override: true });

const app = express();
const PORT = Number(process.env.PORT) || 5050;
app.use(
  cors({
    origin(origin, callback) {
      // Allow server-to-server or curl requests with no browser origin.
      if (!origin) return callback(null, true);
      // Allow local Vite dev origins (5173, 5174, etc.).
      if (/^http:\/\/localhost:517\d$/.test(origin)) return callback(null, true);
      return callback(new Error(`Not allowed by CORS: ${origin}`));
    },
  })
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const RAPIDAPI_HOST = "jsearch.p.rapidapi.com";

const COVER_LETTER_API_HOST = (process.env.COVER_LETTER_API_HOST || "fastapply1.p.rapidapi.com")
  .trim()
  .replace(/^\uFEFF/, "");
const DEFAULT_COVER_LETTER_PATH = "/api/v1/resume-analysis/compatibility-score";

let COVER_LETTER_API_URL = (process.env.COVER_LETTER_API_URL || "").trim().replace(/^\uFEFF/, "");
if (!/^https?:\/\//i.test(COVER_LETTER_API_URL)) {
  const pathPart = COVER_LETTER_API_URL.startsWith("/")
    ? COVER_LETTER_API_URL
    : COVER_LETTER_API_URL
      ? `/${COVER_LETTER_API_URL.replace(/^\/+/, "")}`
      : DEFAULT_COVER_LETTER_PATH;
  COVER_LETTER_API_URL = `https://${COVER_LETTER_API_HOST}${pathPart}`;
}
const COVER_LETTER_API_KEY =
  process.env.COVER_LETTER_API_KEY || process.env.RAPIDAPI_KEY || "";

function formatCoverLetterApiResponse(data) {
  if (data == null) return "";
  if (typeof data === "string") return data.trim();
  const text =
    data.cover_letter ??
    data.coverLetter ??
    data.letter ??
    data.analysis ??
    data.summary ??
    data.message;
  if (typeof text === "string" && text.trim()) return text.trim();
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

function buildJSearchQuery({ query, location }) {
  const q = (query ?? "").toString().trim();
  const loc = (location ?? "").toString().trim();

  if (!q && !loc) return "";
  if (q && !loc) return q;
  if (!q && loc) return `jobs in ${loc}`;

  return `${q} jobs in ${loc}`;
}

app.get("/jobs", async (req, res) => {
  try {
    if (!RAPIDAPI_KEY) {
      return res.status(500).json({
        error: "Missing RAPIDAPI_KEY on server",
      });
    }

    const {
      query,
      location,
      page = "1",
      num_pages = "1",
      country = "us",
      date_posted = "all",
      employment_type = "all",
    } = req.query;

    const builtQuery = buildJSearchQuery({ query, location });
    if (!builtQuery) {
      return res.status(400).json({
        error: "Please provide query and/or location",
      });
    }

    const requestParams = {
      query: builtQuery,
      page,
      num_pages,
      country,
      date_posted,
    };

    if (employment_type && employment_type !== "all") {
      requestParams.employment_types = employment_type;
    }

    const response = await axios.get(`https://${RAPIDAPI_HOST}/search`, {
      params: requestParams,
      headers: {
        "Content-Type": "application/json",
        "x-rapidapi-host": RAPIDAPI_HOST,
        "x-rapidapi-key": RAPIDAPI_KEY,
      },
    });

    const rawJobs = response?.data?.data ?? [];
    const jobs = rawJobs.map((j) => ({
      id: j.job_id ?? j.job_apply_link ?? `${j.employer_name ?? ""}-${j.job_title ?? ""}`,
      title: j.job_title ?? "",
      company: j.employer_name ?? "",
      location:
        j.job_city || j.job_state || j.job_country
          ? [j.job_city, j.job_state, j.job_country].filter(Boolean).join(", ")
          : j.job_location ?? "",
      employmentType: j.job_employment_type ?? "",
      postedAt: j.job_posted_at_datetime_utc ?? "",
      description: j.job_description ?? "",
      applyLink: j.job_apply_link ?? j.job_google_link ?? "",
      source: j.job_publisher ?? "",
    }));

    res.json({
      query: {
        query: builtQuery,
        page: Number(page),
        num_pages: Number(num_pages),
        country,
        date_posted,
        employment_type,
      },
      jobs,
      raw: response.data,
    });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status ?? 500;
      const message =
        (error.response?.data && typeof error.response.data === "object" && "message" in error.response.data
          ? error.response.data.message
          : undefined) ?? error.message;

      console.error("JSearch request failed:", status, message);
      return res.status(status).json({
        error: "Failed to fetch jobs",
        upstream: { status, message },
      });
    }

    console.error(error);
    res.status(500).json({ error: "Failed to fetch jobs" });
  }
});

app.post("/cover-letter", async (req, res) => {
  try {
    if (!COVER_LETTER_API_KEY) {
      return res.status(500).json({
        error: "Missing COVER_LETTER_API_KEY or RAPIDAPI_KEY in backend environment.",
      });
    }

    const { resume = {}, ui = {}, job = {} } = req.body ?? {};
    const resumeText = (resume.text ?? "").toString();
    if (!resumeText.trim()) {
      return res.status(400).json({ error: "Resume text is required (upload a file or paste resume text)." });
    }

    if (!job.title || !job.company || !job.description) {
      return res.status(400).json({ error: "Job title, company, and description are required." });
    }

    const fileName = (resume.fileName ?? "resume.txt").toString().replace(/[^\w.\-]+/g, "_") || "resume.txt";
    const resumeBuffer = Buffer.from(resumeText, "utf8");

    const jobDescription = [
      `Job title: ${job.title}`,
      `Company: ${job.company}`,
      job.location ? `Job location: ${job.location}` : "",
      job.employmentType ? `Employment type (posting): ${job.employmentType}` : "",
      job.source ? `Source: ${job.source}` : "",
      job.applyLink ? `Apply link: ${job.applyLink}` : "",
      "",
      "Job posting:",
      String(job.description),
      "",
      "Search / UI context:",
      `query: ${ui.query ?? ""}`,
      `location: ${ui.location ?? ""}`,
      `country: ${ui.country ?? ""}`,
      `date_posted: ${ui.date_posted ?? ""}`,
      ui.employment_type != null ? `employment_type: ${ui.employment_type}` : "",
      "",
      "Resume text (same content is attached as resume_file):",
      resumeText,
    ]
      .filter((line) => line !== "")
      .join("\n");

    const form = new FormData();
    const uploadName = fileName.toLowerCase().endsWith(".txt") ? fileName : `${fileName}.txt`;
    form.append("resume_file", resumeBuffer, uploadName);
    form.append("job_description", jobDescription);

    const response = await axios.post(COVER_LETTER_API_URL, form, {
      headers: {
        ...form.getHeaders(),
        "x-rapidapi-host": COVER_LETTER_API_HOST,
        "x-rapidapi-key": COVER_LETTER_API_KEY,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    const coverLetter = formatCoverLetterApiResponse(response.data);
    if (!coverLetter) {
      return res.status(502).json({ error: "Cover letter API returned an empty response." });
    }

    return res.json({ coverLetter });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status ?? 500;
      const raw = error.response?.data;
      let message =
        raw && typeof raw === "object" && "message" in raw && typeof raw.message === "string"
          ? raw.message
          : undefined;
      if (!message && typeof raw === "string") {
        const plain = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        message = plain.slice(0, 500) || undefined;
      }
      if (!message) message = error.message;

      let hint = "";
      if (status === 404 && String(message).includes("compatibility-score")) {
        hint =
          " The RapidAPI host responded 404: this path is not available on the server (wrong URL, renamed endpoint, or wrong HTTP method). Open the FastApply API page on RapidAPI → Endpoints, use Test / Code Snippets, and set COVER_LETTER_API_URL (and host if needed) in backend/.env to match exactly.";
      }

      return res.status(status).json({
        error: `Failed to generate cover letter: ${message}${hint}`,
        upstream: { status, message },
      });
    }

    console.error(error);
    return res.status(500).json({ error: "Failed to generate cover letter" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Cover letter upstream: ${COVER_LETTER_API_URL}`);
});