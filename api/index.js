// Vercel Serverless Function entry point for StudyReader
process.env.VERCEL = "1";
const { app } = require("../backend/server");

module.exports = app;
