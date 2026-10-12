// Vercel entry: every request (pages and /api/* routes) is served by the Expo Router server build in dist/server.
// Built by `expo export -p web` (vercel.json buildCommand). Secrets come from the Vercel project's environment variables, never from files.
const path = require('path');
const { createRequestHandler } = require('expo-server/adapter/vercel');

module.exports = createRequestHandler({ build: path.join(__dirname, '../dist/server') });
