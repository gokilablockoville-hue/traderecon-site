// Netlify Function: receive-pnl-report.js
// Receives a CSV file (base64) from Power Automate, parses it, and inserts into Supabase.

const SUPABASE_URL = 'https://wzotlwxhnzlbsnhpfbvq.supabase.co';
const SUPABASE_KEY = 'sb_publishable__iTHME8WgnTgw5mfOaoCvQ_hAdoEZNm';

exports.handler = async (event) => {
  // CORS headers for browser/Power Automate calls
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body);
    // Expected payload from Power Automate:
    // { fileName: "traderecon_pnl_2026-06-26.csv", fileContent: "base64string", contentType: "text/csv" }

    const { fileName, fileContent } = body;
    if (!fileContent) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No file content provided' }) };
    }

    // Decode base64 CSV
    const csvText = Buffer.from(fileContent, 'base64').toString('utf-8');

    // Extract date from filename (e.g. traderecon_pnl_2026-06-26.csv)
    const dateMatch = (fileName || '').match(/(\d{4}-\d{2}-\d{2})/);
    const tradeDate = dateMatch ? dateMatch[1] : new Date().toISOString().slice(0, 10);

    // Parse CSV into rows
    const lines = csvText.trim().split('\n');
    const headerRow = lines[0].split(',').map(h => h.trim());
    const dataRows = lines.slice(1).map(line => {
      const cells = line.split(',');
      const row = {};
      headerRow.forEach((h, i) => { row[h] = cells[i]; });
      return row;
    });

    // Map CSV columns to our pnlRows format
    const pnlRows = dataRows.map(r => ({
      sym: r['Symbol'],
      bqE: parseFloat(r['BuyQty_Exc']) || 0,
      sqE: parseFloat(r['SellQty_Exc']) || 0,
      bvE: parseFloat(r['BuyVal_Exc($)']) || 0,
      svE: parseFloat(r['SellVal_Exc($)']) || 0,
      pnlE: parseFloat(r['RealizedPnL_Exc($)']) || 0,
      openE: parseFloat(r['OpenPos_Exc']) || 0,
      markE: parseFloat(r['AvgCost_Exc($)']) || 0,
      bqI: parseFloat(r['BuyQty_Int']) || 0,
      sqI: parseFloat(r['SellQty_Int']) || 0,
      bvI: parseFloat(r['BuyVal_Int($)']) || 0,
      svI: parseFloat(r['SellVal_Int($)']) || 0,
      pnlI: parseFloat(r['RealizedPnL_Int($)']) || 0,
      openI: parseFloat(r['OpenPos_Int']) || 0,
      markI: parseFloat(r['AvgCost_Int($)']) || 0,
      diff: parseFloat(r['PnL_Diff($)']) || 0,
      status: r['Status'] || 'Match',
    }));

    const excPnl = pnlRows.reduce((a, r) => a + r.pnlE, 0);
    const intPnl = pnlRows.reduce((a, r) => a + r.pnlI, 0);
    const netPnl = excPnl - intPnl;

    const payload = {
      trade_date: tradeDate,
      symbol_count: pnlRows.length,
      exc_pnl: excPnl,
      int_pnl: intPnl,
      net_pnl: netPnl,
      report_data: pnlRows,
      exported_at: new Date().toISOString(),
    };

    // Upsert into Supabase
    const res = await fetch(`${SUPABASE_URL}/rest/v1/traderecon_pl_reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Supabase insert failed', details: errText }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `P&L report for ${tradeDate} saved successfully`,
        tradeDate,
        symbolCount: pnlRows.length,
      }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
