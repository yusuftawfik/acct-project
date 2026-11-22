// Starts the API:  npm start   then open http://127.0.0.1:5000
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 5000);
// Reports are made in the background 8 s after the journal stops changing, so Print is instant.
// EXCEL_PREWARM_MS=0 turns that off (Excel then runs only when a PDF is asked for and is out of date).
const prewarmMs = Number(process.env.EXCEL_PREWARM_MS ?? 8000);
const { app, settings, warmReports } = createApp({ prewarmMs });

app.listen(port, '127.0.0.1', () => {
  console.log(`CIC journal API running at http://127.0.0.1:${port}`);
  console.log(`Database: ${settings.database}`);
  console.log(`Financial year starts ${settings.fyStart}, tax rate ${settings.taxRate}`);
  console.log(`PDF reports: ${settings.exportMode} mode (exports folder: ${settings.exportsDir})`);
  if (settings.exportMode === 'live' && settings.prewarmMs > 0) {
    console.log(`PDF reports are refreshed in the background ${settings.prewarmMs / 1000} s after the journal changes.`);
    warmReports(); // also brings out-of-date PDFs up to date shortly after start
  }
  if (!settings.apiKey) console.log('Warning: CIC_API_KEY is not set, so writes are unprotected (development only).');
});
