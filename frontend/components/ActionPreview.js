export default function ActionPreview({ action, onConfirm, onCancel, loading }) {
  if (!action) {
    return (
      <section className="card">
        <h3>Action Preview</h3>
        <p>Speak a command and Orby will show a preview here.</p>
      </section>
    );
  }

  const { intent, target, message, date, time } = action;

  let previewText = 'Do you want Orby to run this action?';

  if (intent === 'reply_email') {
    previewText = `Do you want Orby to reply to ${target || 'this contact'} with this message?`;
  }

  if (intent === 'schedule_meeting') {
    previewText = `Do you want Orby to schedule this meeting${target ? ` with ${target}` : ''}?`;
  }

  if (intent === 'get_important_emails') {
    previewText = 'Do you want Orby to check and prioritize your emails?';
  }

  return (
    <section className="card">
      <h3>Action Preview</h3>
      <p className="previewPrompt">{previewText}</p>

      <div className="jsonPreview">
        <pre>{JSON.stringify({ intent, target, message, date, time }, null, 2)}</pre>
      </div>

      <div className="actionsRow">
        <button type="button" className="confirmButton" onClick={onConfirm} disabled={loading}>
          Confirm ✅
        </button>
        <button type="button" className="cancelButton" onClick={onCancel} disabled={loading}>
          Cancel ❌
        </button>
      </div>
    </section>
  );
}
