await import('./bootstrap-clean.js');
import('./enrichment-backfill.js').catch(e=>console.error(`[enrich] worker import failed: ${e.stack||e.message}`));
