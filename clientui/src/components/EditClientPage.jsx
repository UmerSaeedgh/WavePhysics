import { useState, useEffect } from "react";

export default function EditClientPage({ apiCall, setError, clientToEdit, previousView, onBack, onSuccess }) {
  const [form, setForm] = useState({
    name: "",
    address: "",
    billing_info: "",
    notes: "",
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (clientToEdit) {
      setForm({
        name: clientToEdit.name || "",
        address: clientToEdit.address || "",
        billing_info: clientToEdit.billing_info || "",
        notes: clientToEdit.notes || "",
      });
    }
  }, [clientToEdit]);

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
      const isEdit = !!clientToEdit;
      const endpoint = isEdit ? `/clients/${clientToEdit.id}` : "/clients";
      const result = await apiCall(endpoint, {
        method: isEdit ? "PUT" : "POST",
        body: JSON.stringify(form),
      });
      
      if (!isEdit && result && result.id) {
        try {
          await apiCall(`/clients/${result.id}/equipments/seed-defaults`, { method: "POST" });
        } catch (seedErr) {
          console.warn("Failed to seed default equipments:", seedErr);
        }
      }
      
      if (onSuccess) {
        onSuccess();
      }
    } catch (err) {
      setError(err.message || "Failed to save client");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "1rem" }}>
        <button className="secondary" onClick={onBack}>
          ← Back to Clients
        </button>
        <h2 style={{ margin: 0 }}>{clientToEdit ? "Edit Client" : "Add New Client"}</h2>
      </div>

      <div className="card">
        <form onSubmit={handleSubmit} style={{ padding: "1rem" }}>
          <label>
            Name *
            <input
              type="text"
              name="name"
              value={form.name}
              onChange={handleChange}
              required
            />
          </label>

          <label>
            Address
            <input
              type="text"
              name="address"
              value={form.address}
              onChange={handleChange}
              placeholder="Client address"
            />
          </label>

          <label>
            Billing Info
            <textarea
              name="billing_info"
              value={form.billing_info}
              onChange={handleChange}
              rows={2}
              placeholder="Billing address, payment terms, etc."
            />
          </label>

          <label>
            Notes
            <textarea
              name="notes"
              value={form.notes}
              onChange={handleChange}
              rows={3}
            />
          </label>

          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "1rem" }}>
            <button type="submit" className="primary" disabled={loading}>
              {loading ? "Saving..." : (clientToEdit ? "Save Changes" : "Create Client")}
            </button>
            <button type="button" className="secondary" onClick={onBack} disabled={loading}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

