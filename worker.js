
const API = "https://api.github.com";

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function jakartaDate() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

async function githubCommit(env) {
  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO,
    GITHUB_BRANCH, GITHUB_EMAIL } = env;

  if (!GITHUB_TOKEN || !GITHUB_OWNER ||
      !GITHUB_REPO || !GITHUB_EMAIL) {
    throw new Error("GitHub configuration incomplete");
  }

  const branch = GITHUB_BRANCH || "main";
  const path = "activity-log.md";
  const date = jakartaDate();

  const headers = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };

  const url = `${API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;

  // Check existing file
  const get = await fetch(
    `${url}?ref=${encodeURIComponent(branch)}`,
    { headers }
  );

  let sha = null;
  let content = "# GitHub Daily Activity\n\n";

  if (get.ok) {
    const old = await get.json();
    sha = old.sha;

    const binary = atob(old.content.replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    content = new TextDecoder().decode(bytes);

    // Prevent duplicate daily commits
    if (content.split("\n").some(line => line === `- ${date}`)) {
      return {
        success: true,
        skipped: true,
        message: "Today's contribution already exists",
        date
      };
    }
  } else if (get.status !== 404) {
    throw new Error(`GitHub GET error: ${await get.text()}`);
  }

  // Add today's actual maintenance log
  content += `- ${date}\n`;

  const bytes = new TextEncoder().encode(content);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  const body = {
    message: `chore: daily maintenance ${date}`,
    content: btoa(binary),
    branch,
    author: {
      name: env.GITHUB_NAME || GITHUB_OWNER,
      email: GITHUB_EMAIL
    },
    committer: {
      name: env.GITHUB_NAME || GITHUB_OWNER,
      email: GITHUB_EMAIL
    },
    ...(sha ? { sha } : {})
  };

  // Create GitHub commit
  const put = await fetch(url, {
    method: "PUT",
    headers: {
      ...headers,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const result = await put.json();

  if (!put.ok) {
    throw new Error(
      `GitHub PUT error ${put.status}: ${JSON.stringify(result)}`
    );
  }

  return {
    success: true,
    message: "Daily contribution committed",
    date,
    file: result.content.path,
    branch,
    commit: result.commit.sha,
    commit_url: result.commit.html_url
  };
}

export default {
  // Automatic daily execution
  async scheduled(controller, env, ctx) {
    const result = await githubCommit(env);
    console.log("Daily contribution:", JSON.stringify(result));
  },

  // HTTP endpoint
  async fetch(request, env) {
    if (request.method === "GET") {
      return json({
        success: true,
        service: "GitHub Auto Contribution",
        status: "online",
        schedule: "Daily at 07:05 WIB"
      });
    }

    if (request.method !== "POST") {
      return json({ success: false, error: "Method not allowed" }, 405);
    }

    if (
      !env.APP_SECRET ||
      request.headers.get("Authorization") !== `Bearer ${env.APP_SECRET}`
    ) {
      return json({ success: false, error: "Unauthorized" }, 401);
    }

    try {
      return json(await githubCommit(env));
    } catch (error) {
      return json({
        success: false,
        error: error.message
      }, 500);
    }
  }
};
