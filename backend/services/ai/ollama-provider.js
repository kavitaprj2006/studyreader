const http = require("http");

function requestJson(options, body) {
  return new Promise((resolve, reject) => {
    const requestObject =
      http.request(
        options,
        (response) => {
          const chunks = [];

          response.on("data", (chunk) => {
            chunks.push(chunk);
          });

          response.on("end", () => {
            let data;

            try {
              data = JSON.parse(
                Buffer.concat(chunks).toString("utf8")
              );
            } catch (error) {
              reject(
                new Error(
                  "Ollama returned an invalid response."
                )
              );
              return;
            }

            if (
              response.statusCode < 200 ||
              response.statusCode >= 300
            ) {
              reject(
                new Error(
                  data.error ||
                  `Ollama returned status ${response.statusCode}.`
                )
              );
              return;
            }

            resolve(data);
          });
        }
      );

    requestObject.on("error", reject);
    requestObject.write(body);
    requestObject.end();
  });
}

async function generate({
  system,
  prompt
}) {
  const host =
    process.env.OLLAMA_HOST || "127.0.0.1";
  const port =
    Number(process.env.OLLAMA_PORT) || 11434;
  const model =
    process.env.OLLAMA_MODEL || "llama3.2:3b";

  const body =
    JSON.stringify({
      model,
      stream: false,
      messages: [
        {
          role: "system",
          content: system
        },
        {
          role: "user",
          content: prompt
        }
      ],
      options: {
        temperature: 0.2
      }
    });

  const result =
    await requestJson(
      {
        method: "POST",
        hostname: host,
        port,
        path: "/api/chat",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body)
        }
      },
      body
    );

  if (
    !result.message ||
    typeof result.message.content !== "string"
  ) {
    throw new Error(
      "Ollama returned no answer."
    );
  }

  return result.message.content.trim();
}

module.exports = {
  generate
};
