import { useEffect, useMemo, useState } from "react";
import { formatDate } from "../utils/formatDate";

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function tomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function computeGreetName(toEmailValue, contactLinks) {
  const emails = (toEmailValue || "")
    .split(/[,;]/)
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  if (emails.length === 0) return "there";
  const names = emails
    .map(e => contactLinks.find(l => (l.email || "").toLowerCase() === e)?.first_name)
    .filter(Boolean);
  const unique = [...new Set(names)];
  if (unique.length === 0) return "there";
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")}, and ${unique[unique.length - 1]}`;
}

function formatAppointmentLabel(dateStr, timeStr) {
  if (!dateStr) return "";
  try {
    const [h, m] = (timeStr || "09:00").split(":");
    const d = new Date(`${dateStr}T${(h || "09").padStart(2, "0")}:${(m || "00").padStart(2, "0")}:00`);
    return d.toLocaleString(undefined, {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
      hour: "numeric", minute: "2-digit",
    });
  } catch {
    return `${dateStr} ${timeStr}`;
  }
}

export default function SendEmailModal({ item, currentUser, apiCall, setError, onClose, onSent }) {
  const today = todayStr();
  const overdue = item?.due_date && item.due_date < today;

  const [contactLinks, setContactLinks] = useState([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [toEmail, setToEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const defaultDate = overdue
    ? (item?.appointment_at ? item.appointment_at.slice(0, 10) : tomorrowStr())
    : (item?.appointment_at ? item.appointment_at.slice(0, 10) : (item?.due_date || tomorrowStr()));
  const defaultTime = item?.appointment_at && item.appointment_at.length >= 16
    ? item.appointment_at.slice(11, 16)
    : "09:00";
  const [appointmentDate, setAppointmentDate] = useState(defaultDate);
  const [appointmentTime, setAppointmentTime] = useState(defaultTime);
  const [durationMin, setDurationMin] = useState(60);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState("");

  const senderName = currentUser?.business_name || currentUser?.username || "Wave Physics";

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingContacts(true);
      try {
        const links = await apiCall(`/contacts/rollup/site/${item.site_id}`);
        if (cancelled) return;
        setContactLinks(links || []);
        const primaries = (links || []).filter(l => l.is_primary && l.email);
        if (primaries.length > 0) {
          const uniqueEmails = [...new Set(primaries.map(p => p.email))];
          setToEmail(uniqueEmails.join(", "));
        } else {
          const anyEmail = (links || []).find(l => l.email);
          if (anyEmail?.email) setToEmail(anyEmail.email);
        }
      } catch (err) {
        if (!cancelled) setLocalError(err.message || "Failed to load contacts");
      } finally {
        if (!cancelled) setLoadingContacts(false);
      }
    }
    if (item?.site_id) load();
    return () => { cancelled = true; };
    // apiCall omitted: its identity changes each render and would cause infinite refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.site_id]);

  useEffect(() => {
    let cancelled = false;
    async function loadTemplates() {
      try {
        const data = await apiCall("/email-templates");
        if (cancelled) return;
        setTemplates(data || []);
        const def = (data || []).find(t => t.is_default);
        if (def) setSelectedTemplateId(String(def.id));
      } catch {
        // Non-fatal — fallback to built-in default.
      }
    }
    loadTemplates();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyPlaceholders(text) {
    if (!item) return text;
    const when = formatAppointmentLabel(appointmentDate, appointmentTime);
    const site = item.site_name || "your site";
    const eqType = item.equipment_type_name || "equipment";
    const dueText = item.due_date ? formatDate(item.due_date) : "soon";
    const greetName = computeGreetName(toEmail, contactLinks);
    return text
      .replaceAll("{greet_name}", greetName)
      .replaceAll("{equipment_type}", eqType)
      .replaceAll("{due_date}", dueText)
      .replaceAll("{appointment_when}", when)
      .replaceAll("{site_name}", site)
      .replaceAll("{sender_name}", senderName);
  }

  useEffect(() => {
    if (!item) return;
    const tpl = templates.find(t => String(t.id) === selectedTemplateId);
    if (tpl) {
      setSubject(applyPlaceholders(tpl.subject_template));
      setBody(applyPlaceholders(tpl.body_template));
      return;
    }
    const siteLabel = item.site_name ? ` at ${item.site_name}` : "";
    setSubject(`Appointment request: ${item.equipment_name}${siteLabel}`);
    const when = formatAppointmentLabel(appointmentDate, appointmentTime);
    const site = item.site_name || "your site";
    const eqType = item.equipment_type_name || "equipment";
    const dueText = item.due_date ? formatDate(item.due_date) : "soon";
    const greetName = computeGreetName(toEmail, contactLinks);
    const draft =
`Hi ${greetName},

Your ${eqType} is coming due on ${dueText}. I'd like to coordinate a time to complete the required testing and services for ${site}.

We currently have the following appointment proposed:
${when}

Please let me know if this time works for you, or feel free to suggest an alternative that better fits your schedule.

Thanks,
${senderName}`;
    setBody(draft);
    // Regenerate when inputs or selected template change; user edits freely afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, appointmentDate, appointmentTime, toEmail, contactLinks.length, selectedTemplateId, templates.length]);

  const appointmentIso = useMemo(() => {
    if (!appointmentDate) return "";
    const t = appointmentTime || "09:00";
    return `${appointmentDate}T${t}:00`;
  }, [appointmentDate, appointmentTime]);

  const dateError = (() => {
    if (!appointmentDate) return "Appointment date is required";
    if (overdue && appointmentDate < today) return "This record is overdue — pick a future date.";
    return "";
  })();

  const endIso = useMemo(() => {
    if (!appointmentIso) return "";
    try {
      const start = new Date(appointmentIso);
      const end = new Date(start.getTime() + durationMin * 60000);
      const pad = (n) => String(n).padStart(2, "0");
      return `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}:00`;
    } catch {
      return "";
    }
  }, [appointmentIso, durationMin]);

  const location = item?.site_name
    ? [item.site_name, item.site_street, item.site_state, item.site_zip_code].filter(Boolean).join(", ")
    : "";

// Opens Outlook Web calendar compose with attendee + event details pre-filled.
  // Teams auto-attach is controlled by the user's Outlook setting
  // ("Add online meeting to all meetings") — not exposed via URL.
  function buildOutlookMeetingUrl() {
    const params = new URLSearchParams();
    params.set("path", "/calendar/action/compose");
    params.set("rru", "addevent");
    params.set("subject", subject);
    const htmlBody = body
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\r?\n/g, "<br>");
    params.set("body", htmlBody);
    if (location) params.set("location", location);
    if (appointmentIso) params.set("startdt", appointmentIso);
    if (endIso) params.set("enddt", endIso);
    if (toEmail) params.set("to", toEmail);
    return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString().replace(/\+/g, "%20")}`;
  }

  async function recordSent() {
    setSaving(true);
    try {
      await apiCall(`/equipment-records/${item.id}/send-email`, {
        method: "POST",
        body: JSON.stringify({
          contact_email: toEmail,
          appointment_at: appointmentIso,
          subject,
          body,
        }),
      });
      if (onSent) onSent();
    } catch (err) {
      setLocalError(err.message || "Failed to record email");
    } finally {
      setSaving(false);
    }
  }

async function handleOpenWebMail() {
    if (!toEmail || !appointmentIso || dateError) return;
    window.open(buildOutlookMeetingUrl(), "_blank", "noopener");
    await recordSent();
    onClose && onClose();
  }

  const disabled = !toEmail || !appointmentIso || !!dateError || saving || loadingContacts;

  return (
    <div
      style={{
        position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: "rgba(45, 50, 52, 0.9)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: "#D7E5D8",
          padding: "2rem",
          borderRadius: "0.75rem",
          maxWidth: "640px",
          maxHeight: "90vh",
          overflow: "auto",
          width: "92%",
          color: "#2D3234",
          boxShadow: "0 25px 50px -12px rgba(0,0,0,0.3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <div>
            <h2 style={{ margin: 0, color: "#2D3234" }}>Send Appointment Email</h2>
            <div style={{ fontSize: "0.85rem", opacity: 0.75, marginTop: "0.2rem" }}>
              {item?.equipment_name}{item?.site_name ? ` · ${item.site_name}` : ""}
              {overdue && (
                <span style={{
                  marginLeft: "0.5rem",
                  padding: "0.1rem 0.5rem",
                  borderRadius: "999px",
                  background: "#ef4444",
                  color: "#fff",
                  fontSize: "0.7rem",
                  fontWeight: 600,
                }}>OVERDUE</span>
              )}
            </div>
          </div>
          <button onClick={onClose} style={{ color: "#2D3234", border: "1px solid #8193A4", background: "transparent" }}>✕</button>
        </div>

        {localError && <div className="error-banner" style={{ marginBottom: "1rem" }}>{localError}</div>}

        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <label>
            To (primary contact email) *
            <input
              type="email"
              value={toEmail}
              onChange={(e) => setToEmail(e.target.value)}
              placeholder={loadingContacts ? "Loading contacts…" : "contact@example.com"}
              required
            />
            {!loadingContacts && contactLinks.length === 0 && (
              <span style={{ fontSize: "0.8rem", color: "#ef4444", marginTop: "0.25rem" }}>
                No contacts are linked to this site. Add one from the site page.
              </span>
            )}
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "1rem" }}>
            <label>
              Appointment date *
              <input
                type="date"
                value={appointmentDate}
                min={overdue ? today : undefined}
                onChange={(e) => setAppointmentDate(e.target.value)}
                required
              />
            </label>
            <label>
              Time *
              <input
                type="time"
                value={appointmentTime}
                onChange={(e) => setAppointmentTime(e.target.value)}
                required
              />
            </label>
            <label>
              Duration
              <select value={durationMin} onChange={(e) => setDurationMin(parseInt(e.target.value, 10))}>
                <option value={30}>30 min</option>
                <option value={60}>1 hour</option>
                <option value={90}>1.5 hours</option>
                <option value={120}>2 hours</option>
                <option value={180}>3 hours</option>
                <option value={240}>4 hours</option>
              </select>
            </label>
          </div>
          {dateError && <div style={{ color: "#ef4444", fontSize: "0.85rem", marginTop: "-0.5rem" }}>{dateError}</div>}
          {!dateError && item?.due_date && !overdue && appointmentDate !== item.due_date && (
            <div style={{ fontSize: "0.8rem", opacity: 0.75, marginTop: "-0.5rem" }}>
              Due date is {formatDate(item.due_date)} — you are proposing a different date.
            </div>
          )}

          {templates.length > 0 && (
            <label>
              Template
              <select
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
              >
                <option value="">Built-in default</option>
                {templates.map(t => (
                  <option key={t.id} value={String(t.id)}>
                    {t.name}{t.is_default ? " (default)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label>
            Subject
            <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>

          <label>
            Body (you can edit this before sending)
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              style={{ fontFamily: "inherit", resize: "vertical" }}
            />
          </label>

          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
            <button
              className="primary"
              onClick={handleOpenWebMail}
              disabled={disabled}
              title="Opens Outlook Web with the meeting invite pre-filled"
            >
              {saving ? "Saving…" : "📅 Send Meeting Invite"}
            </button>
            <button
              className="secondary"
              onClick={onClose}
              disabled={saving}
              style={{ color: "#2D3234", border: "1px solid #8193A4", background: "transparent", marginLeft: "auto" }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
