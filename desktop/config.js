// Build-time configuration for the packaged app.
//
// The Supabase anon key is a public client key: it is designed to ship in
// browser bundles, and every table is protected by row-level security, so
// bundling it here is no different from the deployed web app serving it.
//
// FLOWDESK_URL may be left empty — on first run the app asks the user for it
// and stores the answer in settings.json.

const path = require('node:path')
const fs = require('node:fs')

// Baked in at build time. Populate by editing this file (or let the app prompt).
const BUILD = {
  FLOWDESK_URL: 'https://flow-desk-tan.vercel.app',
  SUPABASE_URL: 'https://bccqkppxfpncdpalhkws.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjY3FrcHB4ZnBuY2RwYWxoa3dzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3MjU0MDAsImV4cCI6MjEwMDMwMTQwMH0.3K0E36slwFeUIOXCZ74e1IwjnrEAvFOy3VEUaRxlwcM',
}

// In development (running from the repo) fall back to the repo's .env files so
// `npm start` keeps working without editing this file.
function readRepoEnv() {
  const out = {}
  for (const file of ['.env', '.env.local']) {
    try {
      const txt = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
      for (const line of txt.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
        if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
      }
    } catch {}
  }
  return out
}

function resolve(isPackaged) {
  const env = isPackaged ? {} : readRepoEnv()
  return {
    flowdeskUrl: process.env.FLOWDESK_URL || BUILD.FLOWDESK_URL || (isPackaged ? '' : 'http://localhost:5173/'),
    supabaseUrl: BUILD.SUPABASE_URL || env.VITE_SUPABASE_URL || '',
    supabaseAnonKey: BUILD.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '',
  }
}

module.exports = { resolve }
