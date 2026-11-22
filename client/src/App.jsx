import { useCallback, useEffect, useState } from 'react';
import Header from './components/Header.jsx';
import EntryForm from './components/EntryForm.jsx';
import EntryLog from './components/EntryLog.jsx';
import Dashboard from './components/Dashboard.jsx';
import { ApiKeyDialog, DeleteDialog, Notice } from './components/Dialogs.jsx';
import { api, setKeyAsker } from './api.js';
import { monthsOf } from './format.js';

// Part 5C: the New entry form, the Entry Log and the Dashboard are live.
export default function App() {
  const [reference, setReference] = useState(null); // { fyStart, accounts, templates }
  const [entries, setEntries] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(null); // entry loaded into the form by the Entry Log (5C)
  const [version, setVersion] = useState(0); // bumps after every change so cards can refetch (5C)
  const [loaded, setLoaded] = useState(false); // reference data and entries have both arrived
  const [pendingDelete, setPendingDelete] = useState(null); // entry waiting for the "Delete entry?" answer
  const [notice, setNotice] = useState(''); // message shown at the bottom of the page
  const [keyRequest, setKeyRequest] = useState(null); // { resolve } while the API key dialog is open
  const closeNotice = useCallback(() => setNotice(''), []);

  // api.js asks this function for the API key when the server answers 401. We show our own dialog.
  useEffect(() => {
    let waiting = null; // one dialog at a time, even if several requests fail together
    setKeyAsker(
      () =>
        (waiting ??= new Promise((resolve) => {
          setKeyRequest({
            resolve: (key) => {
              waiting = null;
              setKeyRequest(null);
              resolve(key);
            },
          });
        })),
    );
    return () => setKeyAsker(null);
  }, []);

  const loadEntries = useCallback(async () => {
    setEntries(await api('/api/entries'));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [health, accounts, templates] = await Promise.all([
          api('/api/health'),
          api('/api/accounts'),
          api('/api/templates'),
        ]);
        setReference({ fyStart: health.financial_year_start, accounts, templates });
        await loadEntries();
        setLoaded(true);
      } catch (e) {
        setLoadError(e.message);
      }
    })();
  }, [loadEntries]);

  const onSaved = useCallback(async () => {
    await loadEntries();
    setVersion((v) => v + 1);
  }, [loadEntries]);

  const deleteEntry = async (id) => {
    try {
      await api(`/api/entries/${id}`, { method: 'DELETE' });
      if (editing && editing.id === id) setEditing(null);
      await onSaved();
    } catch (e) {
      setNotice(e.message);
    }
  };

  const confirmDelete = () => {
    const entry = pendingDelete;
    setPendingDelete(null);
    if (entry) deleteEntry(entry.id);
  };

  // "Clear all data" and "Run sample data" in the New entry card. Errors go back to the card, which shows them.
  const clearAll = async () => {
    await api('/api/entries', { method: 'DELETE' });
    setEditing(null);
    await onSaved();
  };
  const runSample = async () => {
    const result = await api('/api/sample-data?replace=1', { method: 'POST' });
    setEditing(null);
    await onSaved();
    return result;
  };

  const editEntry = (entry) => {
    setEditing(entry);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Month used by "Suggest tax entry" when no date is chosen yet: the latest month with entries, else the last month.
  const defaultMonth = reference
    ? entries.reduce((latest, e) => (e.date.slice(0, 7) > latest ? e.date.slice(0, 7) : latest), '') ||
      monthsOf(reference.fyStart)[11].value
    : '';

  return (
    <>
      <Header />
      <main className="page">
        <div className="top-row">
          {reference ? (
            <EntryForm
              accounts={reference.accounts}
              templates={reference.templates}
              fyStart={reference.fyStart}
              defaultMonth={defaultMonth}
              editing={editing}
              entryCount={entries.length}
              onSaved={onSaved}
              onCancelEdit={() => setEditing(null)}
              onClearAll={clearAll}
              onRunSample={runSample}
            />
          ) : (
            <section className="panel entry-form" aria-label="New entry">
              <h2 className="panel__title">New entry</h2>
              <p className="form-note form-note--err">
                {loadError ? `Cannot reach the API: ${loadError}` : 'Loading...'}
              </p>
            </section>
          )}
          <EntryLog
            entries={entries}
            templates={reference ? reference.templates : []}
            editingId={editing ? editing.id : null}
            onEdit={editEntry}
            onDelete={setPendingDelete}
          />
        </div>
        <Dashboard
          ready={Boolean(reference) && loaded}
          fyStart={reference ? reference.fyStart : ''}
          defaultMonth={defaultMonth}
          version={version}
        />
      </main>
      {pendingDelete && (
        <DeleteDialog entry={pendingDelete} onConfirm={confirmDelete} onCancel={() => setPendingDelete(null)} />
      )}
      {keyRequest && (
        <ApiKeyDialog onSubmit={(key) => keyRequest.resolve(key)} onCancel={() => keyRequest.resolve('')} />
      )}
      {notice && <Notice text={notice} onClose={closeNotice} />}
    </>
  );
}
