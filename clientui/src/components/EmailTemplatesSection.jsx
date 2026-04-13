import { useEffect, useState } from "react";

const PLACEHOLDERS = [
  "{greet_name}", "{equipment_type}", "{due_date}",
  "{appointment_when}", "{site_name}", "{sender_name}",
];

const DEFAULT_SUBJECT = "Appointment request: {equipment_type} at {site_name}";
const DEFAULT_BODY = `Hi {greet_name},

Your {equipment_type} is coming due on {due_date}. I'd like to coordinate a time to complete the required testing and services for {site_name}.

We currently have the following appointment proposed:
{appointment_when}

Please let me know if this time works for you, or feel free to suggest an alternative that better fits your schedule.

Thanks,
{sender_name}`;

export default function EmailTemplatesSection({ apiCall, setError }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", subject_template: DEFAULT_SUBJECT, body_template: DEFAULT_BODY, is_default: false });
  const [expanded, setExpanded] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const data = await apiCall("/email-templates");
      setTemplates(data || []);
    } catch (err) {
      setError(err.message || "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetForm() {
    setEditing(null);
    setForm({ name: "", subject_template: DEFAULT_SUBJECT, body_template: DEFAULT_BODY, is_default: false });
  }

  function startEdit(t) {
    setEditing(t);
    setForm({
      name: t.name,
      subject_template: t.subject_template,
      body_template: t.body_template,
      is_default: !!t.is_default,
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!form.name.trim() || !form.subject_template.trim() || !form.body_template.trim()) {
      setError("Name, subject, and body are required");
      return;
    }
    const combined = `${form.subject_template}\n${form.body_template}`;
    const missing = PLACEHOLDERS.filter(p => !combined.includes(p));
    if (missing.length > 0) {
      setError(`Template is missing required placeholder(s): ${missing.join(", ")}. Please include each placeholder somewhere in the subject or body.`);
      return;
    }
    try {
      if (editing) {
        await apiCall(`/email-templates/${editing.id}`, {
          method: "PUT",
          body: JSON.stringify(form),
        });
      } else {
        await apiCall("/email-templates", {
          method: "POST",
          body: JSON.stringify(form),
        });
      }
      await refresh();
      resetForm();
    } catch {
      // error already set
    }
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this template?")) return;
    try {
      await apiCall(`/email-templates/${id}`, { method: "DELETE" });
      await refresh();
      if (editing?.id === id) resetForm();
    } catch {
      // error already set
    }
  }

  async function handleSetDefault(id) {
    try {
      await apiCall(`/email-templates/${id}`, {
        method: "PUT",
        body: JSON.stringify({ is_default: true }),
      });
      await refresh();
    } catch {
      // error already set
    }
  }

  return (
    <div className="card" style={{ marginBottom: "1.5rem" }}>
      <div
        className="card-header"
        style={{ cursor: "pointer" }}
        onClick={() => setExpanded(!expanded)}
      >
        <h2 style={{ margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{
            transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.2s",
            display: "inline-block",
            fontSize: "0.75rem",
          }}>▶</span>
          Email Templates
          <span style={{ fontSize: "0.875rem", fontWeight: "normal", color: "#8193A4", marginLeft: "0.5rem" }}>
            ({templates.length})
          </span>
        </h2>
      </div>

      {expanded && (
        <div style={{ marginTop: "1rem" }}>
          <div className="two-column">
            <div>
              <div className="card-header">
                <h3 style={{ margin: 0 }}>{editing ? "Edit Template" : "New Template"}</h3>
                {editing && <button className="secondary" onClick={resetForm}>+ New</button>}
              </div>
              <form onSubmit={handleSubmit} className="form">
                <label>
                  Name *
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                  />
                </label>
                <label>
                  Subject *
                  <input
                    type="text"
                    value={form.subject_template}
                    onChange={(e) => setForm({ ...form, subject_template: e.target.value })}
                    required
                  />
                </label>
                <label>
                  Body *
                  <textarea
                    rows={12}
                    value={form.body_template}
                    onChange={(e) => setForm({ ...form, body_template: e.target.value })}
                    style={{ fontFamily: "inherit", resize: "vertical" }}
                    required
                  />
                </label>
                <div style={{ fontSize: "0.8rem", color: "#2D3234", opacity: 0.75 }}>
                  Placeholders: {PLACEHOLDERS.join(", ")}
                </div>
                <label
                  className="checkbox-label"
                  style={{
                    padding: "0.6rem 0.9rem",
                    border: `1.5px solid ${form.is_default ? "#10b981" : "#8193A4"}`,
                    borderRadius: "0.5rem",
                    background: form.is_default ? "rgba(16, 185, 129, 0.08)" : "transparent",
                    cursor: "pointer",
                    transition: "all 0.15s",
                    fontWeight: 500,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={form.is_default}
                    onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
                    style={{ width: "1rem", height: "1rem", accentColor: "#10b981", margin: 0 }}
                  />
                  <span>Use as default template</span>
                  {form.is_default && (
                    <span style={{
                      marginLeft: "auto",
                      padding: "0.1rem 0.5rem",
                      borderRadius: "999px",
                      background: "#10b981",
                      color: "#fff",
                      fontSize: "0.7rem",
                      fontWeight: 600,
                    }}>DEFAULT</span>
                  )}
                </label>
                <button type="submit" className="primary">
                  {editing ? "Save" : "Create"}
                </button>
              </form>
            </div>

            <div>
              <div className="card-header">
                <h3 style={{ margin: 0 }}>Templates</h3>
                <button className="secondary" onClick={refresh}>Refresh</button>
              </div>
              {loading ? (
                <p className="empty">Loading…</p>
              ) : templates.length === 0 ? (
                <p className="empty">No custom templates yet. The built-in default will be used.</p>
              ) : (
                <ul className="list">
                  {templates.map(t => (
                    <li key={t.id} className="list-item">
                      <div className="list-main">
                        <div className="list-title">
                          {t.name}
                          {t.is_default && (
                            <span style={{
                              marginLeft: "0.5rem",
                              padding: "0.1rem 0.5rem",
                              borderRadius: "999px",
                              background: "#10b981",
                              color: "#fff",
                              fontSize: "0.7rem",
                              fontWeight: 600,
                            }}>DEFAULT</span>
                          )}
                        </div>
                        <div className="list-subtitle" style={{ opacity: 0.75 }}>
                          {t.subject_template}
                        </div>
                      </div>
                      <div className="list-actions">
                        {!t.is_default && (
                          <button onClick={() => handleSetDefault(t.id)}>Set default</button>
                        )}
                        <button onClick={() => startEdit(t)}>Edit</button>
                        <button className="danger" onClick={() => handleDelete(t.id)}>Delete</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
