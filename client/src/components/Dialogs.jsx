import { useEffect, useState } from 'react';
import { eid } from '../format.js';

// In-page replacements for the browser's confirm / alert / prompt boxes.

/** Centered box over a dimmed page. Escape or a click outside closes it (same as Cancel). */
function Dialog({ title, onClose, children, actions }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h2 className="panel__title dialog__title">{title}</h2>
        <div className="dialog__body">{children}</div>
        <div className="dialog__actions">{actions}</div>
      </div>
    </div>
  );
}

/** "Delete entry E0012?" Cancel has the focus, so pressing Enter by accident does not delete. */
export function DeleteDialog({ entry, onConfirm, onCancel }) {
  return (
    <Dialog
      title={`Delete entry ${eid(entry.id)}?`}
      onClose={onCancel}
      actions={
        <>
          <button type="button" className="btn btn--outline" onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button type="button" className="btn btn--post" onClick={onConfirm}>
            Delete entry
          </button>
        </>
      }
    >
      <p className="dialog__text">
        This removes the entry dated {entry.date} from the journal and updates every report. It cannot be undone.
      </p>
    </Dialog>
  );
}

/** Plain yes/no question. Cancel has the focus, so pressing Enter by accident changes nothing. */
export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }) {
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      actions={
        <>
          <button type="button" className="btn btn--outline" onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button type="button" className="btn btn--post" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="dialog__text">{message}</p>
    </Dialog>
  );
}

/** Asks for the API key when the server protects changes with one. */
export function ApiKeyDialog({ onSubmit, onCancel }) {
  const [key, setKey] = useState('');
  const submit = () => onSubmit(key.trim());
  return (
    <Dialog
      title="API key needed"
      onClose={onCancel}
      actions={
        <>
          <button type="button" className="btn btn--outline" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn--post" onClick={submit} disabled={!key.trim()}>
            Save key
          </button>
        </>
      }
    >
      <label className="field">
        <span className="dialog__text">This server needs an API key for changes. Enter it:</span>
        <input
          className="input"
          type="password"
          autoComplete="off"
          autoFocus
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && key.trim()) submit();
          }}
        />
      </label>
    </Dialog>
  );
}

/** Small message at the bottom of the page (replaces alert). Closes itself after a few seconds. */
export function Notice({ text, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 8000);
    return () => clearTimeout(t);
  }, [text, onClose]);

  return (
    <div className="notice" role="alert">
      <span className="notice__text">{text}</span>
      <button type="button" className="row-btn" onClick={onClose}>
        Dismiss
      </button>
    </div>
  );
}
