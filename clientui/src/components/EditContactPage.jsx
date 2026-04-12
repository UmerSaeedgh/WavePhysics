import { useState, useEffect } from "react";

export default function EditContactPage({ apiCall, setError, contactToEdit, contactContext, contactLinks, onRefreshContacts, onSuccess, onBack }) {
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    role: "",
    is_primary: false,
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (contactToEdit) {
      setForm({
        first_name: contactToEdit.first_name || "",
        last_name: contactToEdit.last_name || "",
        email: contactToEdit.email || "",
        phone: contactToEdit.phone || "",
        role: contactToEdit.role || "",
        is_primary: contactToEdit.is_primary || false,
      });
    } else {
      setForm({ first_name: "", last_name: "", email: "", phone: "", role: "", is_primary: false });
    }
  }, [contactToEdit]);

  function handleChange(e) {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setError("First and last name are required");
      return;
    }
    if (!form.email.trim()) {
      setError("Email is required");
      return;
    }

    setLoading(true);
    try {
      const isEdit = !!contactToEdit;
      let contactId;
      
      if (isEdit) {
        const result = await apiCall(`/contacts/${contactToEdit.contact_id}`, {
          method: "PUT",
          body: JSON.stringify({
            first_name: form.first_name,
            last_name: form.last_name,
            email: form.email,
            phone: form.phone,
          }),
        });
        contactId = result.id;
        
        if (contactToEdit.id) {
          try {
            await apiCall(`/contact-links/${contactToEdit.id}`, {
              method: "PUT",
              body: JSON.stringify({
                role: form.role,
                is_primary: form.is_primary,
              }),
            });
          } catch (linkErr) {
            console.warn("Failed to update contact link:", linkErr);
            setError(linkErr.message || "Failed to update contact link");
          }
        }
      } else {
        const result = await apiCall("/contacts", {
          method: "POST",
          body: JSON.stringify({
            first_name: form.first_name,
            last_name: form.last_name,
            email: form.email,
            phone: form.phone,
          }),
        });
        contactId = result.id;
        
        if (contactContext?.site) {
          try {
            await apiCall("/contact-links", {
              method: "POST",
              body: JSON.stringify({
                contact_id: contactId,
                scope: "SITE",
                scope_id: contactContext.site.id,
                role: form.role || "Contact",
                is_primary: form.is_primary,
              }),
            });
          } catch (linkErr) {
            console.warn("Failed to link contact:", linkErr);
          }
        } else if (contactContext?.client) {
          try {
            await apiCall("/contact-links", {
              method: "POST",
              body: JSON.stringify({
                contact_id: contactId,
                scope: "CLIENT",
                scope_id: contactContext.client.id,
                role: form.role || "Contact",
                is_primary: form.is_primary,
              }),
            });
          } catch (linkErr) {
            console.warn("Failed to link contact:", linkErr);
          }
        }
      }
      
      if (onSuccess) {
        onSuccess();
      }
    } catch (err) {
      setError(err.message || "Failed to save contact");
    } finally {
      setLoading(false);
    }
  }

  const contextName = contactContext?.site?.name || contactContext?.client?.name || "Unknown";

  return (
    <div>
      <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "1rem" }}>
        <button className="secondary" onClick={onBack}>
          ← Back
        </button>
        <h2 style={{ margin: 0 }}>{contactToEdit ? "Edit Contact" : "Add New Contact"}</h2>
      </div>

      <div className="card">
        <div style={{ padding: "0.5rem 1rem", backgroundColor: "#8193A4", color: "#2D3234", fontSize: "0.9rem", marginBottom: "1rem" }}>
          {contactContext?.site ? `Site: ${contextName}` : contactContext?.client ? `Client: ${contextName}` : ""}
        </div>

        <form onSubmit={handleSubmit} className="form" style={{ padding: "1rem" }}>
          <label>
            First Name *
            <input type="text" name="first_name" value={form.first_name} onChange={handleChange} required />
          </label>
          <label>
            Last Name *
            <input type="text" name="last_name" value={form.last_name} onChange={handleChange} required />
          </label>
          <label>
            Email *
            <input type="email" name="email" value={form.email} onChange={handleChange} required />
          </label>
          <label>
            Phone
            <input type="tel" name="phone" value={form.phone} onChange={handleChange} />
          </label>
          <label>
            Role
            <input type="text" name="role" value={form.role} onChange={handleChange} placeholder="e.g. Manager, Technician" />
          </label>
          <div
            role="button"
            tabIndex={0}
            onClick={() => setForm(prev => ({ ...prev, is_primary: !prev.is_primary }))}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                setForm(prev => ({ ...prev, is_primary: !prev.is_primary }));
              }
            }}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "1rem",
              padding: "0.85rem 1rem",
              border: `1.5px solid ${form.is_primary ? "#10b981" : "#8193A4"}`,
              borderRadius: "0.5rem",
              background: form.is_primary ? "rgba(16, 185, 129, 0.08)" : "transparent",
              cursor: "pointer",
              userSelect: "none",
              transition: "all 0.15s ease",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
              <span style={{ fontWeight: 600, color: "#2D3234" }}>Primary Contact</span>
              <span style={{ fontSize: "0.8rem", color: "#2D3234", opacity: 0.7 }}>
                The primary contact receives appointment emails for this {contactContext?.site ? "site" : "client"}.
              </span>
            </div>
            <span
              aria-hidden="true"
              style={{
                position: "relative",
                width: "44px",
                height: "24px",
                borderRadius: "999px",
                background: form.is_primary ? "#10b981" : "#cbd5e1",
                transition: "background 0.15s ease",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: "2px",
                  left: form.is_primary ? "22px" : "2px",
                  width: "20px",
                  height: "20px",
                  borderRadius: "50%",
                  background: "#fff",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                  transition: "left 0.15s ease",
                }}
              />
            </span>
            <input type="checkbox" name="is_primary" checked={form.is_primary} onChange={handleChange} style={{ display: "none" }} />
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "1rem" }}>
            <button type="submit" className="primary" disabled={loading}>
              {loading ? "Saving..." : (contactToEdit ? "Save Changes" : "Create Contact")}
            </button>
            <button type="button" className="secondary" onClick={onBack} disabled={loading}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

