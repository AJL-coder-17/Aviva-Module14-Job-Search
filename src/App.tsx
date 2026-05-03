import { useState } from "react";
import axios from "axios";
import "./App.css";

type Job = {
  id?: string;
  title: string;
  company: string;
  location?: string;
  employmentType?: string;
  postedAt?: string;
  source?: string;
  description: string;
  applyLink: string;
  match?: number;
};

type EmploymentTypeFilter = "all" | "FULLTIME" | "PARTTIME" | "CONTRACTOR" | "TEMPORARY";

export default function JobAssistant() {
  const apiBaseUrl =
    (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || "http://localhost:5050";
  const [jobs, setJobs] = useState<Job[]>([]);
  const [query, setQuery] = useState("frontend developer");
  const [location, setLocation] = useState("New Jersey");
  const [country, setCountry] = useState("USA");
  const [datePosted, setDatePosted] = useState("all");
  const [employmentType, setEmploymentType] = useState<EmploymentTypeFilter>("all");
  const [resumeText, setResumeText] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [coverLetters, setCoverLetters] = useState<Record<string, string>>({});
  const [coverLetterErrors, setCoverLetterErrors] = useState<Record<string, string>>({});
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);

  const fetchJobs = async () => {
    try {
      const response = await axios.get(`${apiBaseUrl}/jobs`, {
        params: {
          query,
          location,
          country,
          date_posted: datePosted,
          employment_type: employmentType,
        },
      });

      const data: Job[] = response.data?.jobs || [];
      setJobs(data.slice(0, 20));
    } catch (error) {
      console.error("Error fetching jobs:", error);
    }
  };

  const handleResumeUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setResumeFile(file);

    const reader = new FileReader();
    reader.onload = () => {
      const raw = typeof reader.result === "string" ? reader.result : "";
      setResumeText(raw.replace(/^\uFEFF/, ""));
    };
    reader.readAsText(file, "UTF-8");
  };

  const calculateMatch = (resume: string, desc: string) => {
    if (!resume) return 0;

    const resumeWords = resume.toLowerCase().split(/\W+/);
    const descWords = desc.toLowerCase().split(/\W+/);

    let matchCount = 0;

    descWords.forEach((word) => {
      if (resumeWords.includes(word)) matchCount++;
    });

    return Math.min(100, Math.round((matchCount / descWords.length) * 100));
  };

  const sortedJobs = jobs
    .map((job) => ({
      ...job,
      match: calculateMatch(resumeText, job.description),
    }))
    .sort((a, b) => (b.match || 0) - (a.match || 0));

  const generateCoverLetter = async (job: Job) => {
    const jobKey = job.id ?? `${job.company}-${job.title}`;
    setGeneratingFor(jobKey);
    try {
      setCoverLetterErrors((prev) => ({ ...prev, [jobKey]: "" }));

      if (!resumeText.trim()) {
        setCoverLetterErrors((prev) => ({
          ...prev,
          [jobKey]: "Please upload a resume file (or ensure it loaded as text) before generating.",
        }));
        return;
      }

      const response = await axios.post(`${apiBaseUrl}/cover-letter`, {
        resume: {
          text: resumeText,
          fileName: resumeFile?.name ?? "resume.txt",
        },
        ui: {
          query,
          location,
          country,
          date_posted: datePosted,
          employment_type: employmentType,
        },
        job: {
          title: job.title,
          company: job.company,
          description: job.description,
          applyLink: job.applyLink,
          location: job.location,
          employmentType: job.employmentType,
          source: job.source,
        },
      });

      const generated = response.data?.coverLetter;
      if (!generated) {
        setCoverLetterErrors((prev) => ({
          ...prev,
          [jobKey]: "Cover letter API returned an empty response.",
        }));
        return;
      }

      setCoverLetters((prev) => ({ ...prev, [jobKey]: generated }));
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const message =
          (typeof error.response?.data?.error === "string" && error.response.data.error) ||
          (typeof error.response?.data?.upstream?.message === "string" &&
            error.response.data.upstream.message) ||
          "Failed to generate cover letter.";
        setCoverLetterErrors((prev) => ({ ...prev, [jobKey]: message }));
      } else {
        setCoverLetterErrors((prev) => ({
          ...prev,
          [jobKey]: "Failed to generate cover letter.",
        }));
      }
    } finally {
      setGeneratingFor(null);
    }
  };

  return (
    <div className="job-assistant">
      <h2 className="job-assistant__title">Job Search Assistant</h2>

      <div className="job-assistant__form">
        <div className="job-assistant__field">
          <div className="job-assistant__label"> Title * </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="frontend developer"
            className="job-assistant__control"
          />
        </div>

        <div className="job-assistant__field">
          <div className="job-assistant__label">Location (location)</div>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="New Jersey"
            className="job-assistant__control"
          />
        </div>

        <div className="job-assistant__field job-assistant__field--sm">
          <div className="job-assistant__label">Country (country)</div>
          <input
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            placeholder="USA"
            className="job-assistant__control"
          />
        </div>

        <div className="job-assistant__field job-assistant__field--md">
          <div className="job-assistant__label">Date posted (date_posted)</div>
          <select
            value={datePosted}
            onChange={(e) => setDatePosted(e.target.value)}
            className="job-assistant__control"
          >
            <option value="all">Any time</option>
            <option value="today">Today</option>
            <option value="3days">Last 3 days</option>
            <option value="week">Last week</option>
            <option value="month">Last month</option>
          </select>
        </div>

        <div className="job-assistant__field job-assistant__field--md">
          <div className="job-assistant__label">Employment Type</div>
          <select
            value={employmentType}
            onChange={(e) => setEmploymentType(e.target.value as EmploymentTypeFilter)}
            className="job-assistant__control"
          >
            <option value="all">All</option>
            <option value="FULLTIME">Full-time</option>
            <option value="PARTTIME">Part-time</option>
            <option value="CONTRACTOR">Contract</option>
            <option value="TEMPORARY">Temporary</option>
          </select>
        </div>

        <button onClick={fetchJobs} className="job-assistant__submit">
          Search Jobs
        </button>
      </div>

      <br />
      <br />

      <div className="job-assistant__resume">
        <div className="job-assistant__label">Resume upload (optional)</div>
        <input type="file" onChange={handleResumeUpload} />
      </div>

      <br />
      <br />

      {sortedJobs.map((job, index) => (
        <div
          key={job.id ?? `${job.company}-${job.title}-${index}`}
          className="job-assistant__card"
        >
          {coverLetterErrors[job.id ?? `${job.company}-${job.title}`] ? (
            <div className="job-assistant__error">
              {coverLetterErrors[job.id ?? `${job.company}-${job.title}`]}
            </div>
          ) : null}

          <h3>{job.title}</h3>
          <p>
            <strong>{job.company}</strong>
          </p>
          {job.location ? <p>{job.location}</p> : null}
          {job.employmentType ? <p>{job.employmentType}</p> : null}
          <p>Match: {job.match ?? 0}%</p>

          {job.applyLink ? (
            <a href={job.applyLink} target="_blank" rel="noreferrer">
              Apply Here
            </a>
          ) : (
            <p>No apply link provided.</p>
          )}

          <details>
            <summary>Job Description</summary>
            <p>{job.description}</p>
          </details>

          <button
            onClick={() => generateCoverLetter(job)}
            className="job-assistant__cover-letter-btn"
            disabled={generatingFor === (job.id ?? `${job.company}-${job.title}`)}
          >
            {generatingFor === (job.id ?? `${job.company}-${job.title}`)
              ? "Generating..."
              : "Generate Cover Letter"}
          </button>

          {coverLetters[job.id ?? `${job.company}-${job.title}`] ? (
            <details className="job-assistant__cover-letter">
              <summary>Cover Letter</summary>
              <pre className="job-assistant__cover-letter-text">
                {coverLetters[job.id ?? `${job.company}-${job.title}`]}
              </pre>
            </details>
          ) : null}
        </div>
      ))}
    </div>
  );
}