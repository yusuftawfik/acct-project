import { useEffect, useState } from 'react';
import ReportCard from './ReportCard.jsx';
import PrintPanel from './PrintPanel.jsx';
import { api, apiBlob } from '../api.js';
import { f2, monthsOf } from '../format.js';

// Part 5C: the three cards are live. Each card has its own "Report through" month and asks
// GET /api/summary?through=YYYY-MM for it. Every card refetches when `version` changes
// (App bumps it after each post, edit and delete).
const WAITING = [{ value: '', label: 'Loading...' }];

// Latest summary for one month. The result only counts for the month it was fetched for, so a card
// never shows figures under the wrong month label. A refetch of the same month keeps the old numbers
// on screen until the new ones arrive.
function useSummary(month, version, enabled) {
  const [state, setState] = useState({ month: null, data: null, error: '' });

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false; // a late answer for an older month or version is ignored
    api(`/api/summary?through=${month}`).then(
      (data) => {
        if (!cancelled) setState({ month, data, error: '' });
      },
      (e) => {
        if (!cancelled) setState({ month, data: null, error: e.message });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [month, version, enabled]);

  return state.month === month ? state : { month, data: null, error: '' };
}

// fields: [[column label, key in the summary]]
function LiveCard({ title, subtitle, fields, showBalance, ready, months, defaultMonth, version }) {
  const [chosen, setChosen] = useState(null); // null = still following the default month
  const month = chosen ?? defaultMonth;
  const { data, error } = useSummary(month, version, ready && Boolean(month));

  const columns = fields.map(([label, key]) => ({
    label,
    value: data ? f2(data[key]) : error ? '—' : '...',
  }));

  let badge = null;
  if (error) badge = { text: 'Could not load', tone: 'bad', title: error };
  else if (showBalance && data && !data.balanced) {
    // Only an unbalanced equation gets a badge; a balanced one shows nothing.
    badge = { text: `Off by ${f2(Math.abs(data.balance_difference))}`, tone: 'bad' };
  }

  return (
    <ReportCard
      title={title}
      subtitle={subtitle}
      columns={columns}
      months={ready ? months : WAITING}
      month={ready ? month : ''}
      onMonthChange={ready ? setChosen : undefined}
      badge={badge}
    />
  );
}

export default function Dashboard({ ready, fyStart, defaultMonth, version }) {
  const months = ready ? monthsOf(fyStart) : WAITING;
  const [busySlug, setBusySlug] = useState('');
  const [printError, setPrintError] = useState('');

  const print = async (slug) => {
    setBusySlug(slug);
    setPrintError('');
    try {
      // Reports cover the journal through the latest month that has entries (the same month the cards start on).
      const through = defaultMonth ? `?through=${encodeURIComponent(defaultMonth)}` : '';
      const blob = await apiBlob(`/api/reports/${slug}.pdf${through}`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${slug}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      setPrintError(`Could not prepare the PDF. ${e.message}`);
    } finally {
      setBusySlug('');
    }
  };

  const shared = { ready, months, defaultMonth, version };

  return (
    <section className="dashboard" aria-label="Dashboard">
      <h2 className="dashboard__title">Dashboard</h2>
      <div className="dashboard__body">
        <div className="dashboard__cards">
          <LiveCard
            {...shared}
            title="Cash Position"
            subtitle="Cash on hand"
            fields={[['Cash balance', 'cash']]}
          />
          <LiveCard
            {...shared}
            title="Accounting Equation"
            subtitle="Assets = Liabilities + Owner's Equity"
            fields={[
              ['Assets', 'assets'],
              ['Liabilities', 'liabilities'],
              ['Equity', 'equity'],
            ]}
            showBalance
          />
          <LiveCard
            {...shared}
            title="Profit & Loss"
            subtitle="Profit before tax − Income tax = Net income"
            fields={[
              ['Profit before tax', 'profit_before_tax'],
              ['Income tax', 'income_tax'],
              ['Net income', 'net_income'],
            ]}
          />
        </div>
        <PrintPanel onPrint={print} busySlug={busySlug} error={printError} />
      </div>
    </section>
  );
}
