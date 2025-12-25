import { useState, useEffect } from "react";
import ContactManagementSection from "./ContactManagementSection";

export default function EditSitePage({ apiCall, setError, siteToEdit, client, contactLinks, onRefreshContacts, onEditContact, onSuccess, onBack }) {
  const [form, setForm] = useState({
    name: "",
    address: "",
    timezone: "America/Chicago",
    notes: "",
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (siteToEdit) {
      setForm({
        name: siteToEdit.name || "",
        address: siteToEdit.address || "",
        timezone: siteToEdit.timezone || "America/Chicago",
        notes: siteToEdit.notes || "",
      });
      if (onRefreshContacts) {
        onRefreshContacts();
      }
    } else {
      setForm({ name: "", address: "", timezone: "America/Chicago", notes: "" });
    }
  }, [siteToEdit?.id]);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) {
      setError("Name is required");
      return;
    }

    setLoading(true);
    try {
      const isEdit = !!siteToEdit;
      const endpoint = isEdit ? `/sites/${siteToEdit.id}` : "/sites";
      const payload = { ...form, client_id: client.id };
      await apiCall(endpoint, {
        method: isEdit ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      if (onSuccess) {
        onSuccess();
      }
    } catch (err) {
      setError(err.message || "Failed to save site");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "1rem" }}>
        <button className="secondary" onClick={onBack}>
          ← Back to Sites
        </button>
        <h2 style={{ margin: 0 }}>{siteToEdit ? "Edit Site" : "Add New Site"}</h2>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <form onSubmit={handleSubmit} className="form">
          <label>
            Name *
            <input type="text" name="name" value={form.name} onChange={handleChange} required />
          </label>
          <label>
            Address
            <input type="text" name="address" value={form.address} onChange={handleChange} placeholder="Site address" />
          </label>
          <label>
            Timezone
            <input type="text" name="timezone" value={form.timezone} onChange={handleChange} placeholder="America/Chicago" />
          </label>
          <label>
            Notes
            <textarea name="notes" value={form.notes} onChange={handleChange} rows={3} />
          </label>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "1rem" }}>
            <button type="submit" className="primary" disabled={loading}>
              {loading ? "Saving..." : (siteToEdit ? "Save Changes" : "Create Site")}
            </button>
            <button type="button" className="secondary" onClick={onBack} disabled={loading}>Cancel</button>
          </div>
        </form>
      </div>

      {siteToEdit && onEditContact && (
        <div style={{ marginTop: "1rem" }}>
          <ContactManagementSection
            site={siteToEdit}
            client={client}
            contactLinks={contactLinks}
            onRefreshContacts={onRefreshContacts}
            onEditContact={onEditContact}
            apiCall={apiCall}
            setError={setError}
          />
        </div>
      )}
    </div>
  );
}

