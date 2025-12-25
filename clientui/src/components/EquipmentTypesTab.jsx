import { useState } from "react";

export default function EquipmentTypesTab({ equipmentTypes, onRefresh, apiCall, setError }) {
  const [selectedType, setSelectedType] = useState(null);
  const [form, setForm] = useState({
    name: "",
    interval_weeks: "",
    rrule: "",
    default_lead_weeks: "",
    inactive: false,
  });

  function handleChange(e) {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  }

  function resetForm() {
    setSelectedType(null);
    setForm({
      name: "",
      interval_weeks: "",
      rrule: "",
      default_lead_weeks: "",
      inactive: false,
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!form.name.trim() || !form.interval_weeks || !form.rrule || !form.default_lead_weeks) {
      setError("All fields are required");
      return;
    }

    try {
      const isEdit = !!selectedType;
      const endpoint = isEdit ? `/equipment-types/${selectedType.id}` : "/equipment-types";
      const payload = {
        ...form,
        interval_weeks: parseInt(form.interval_weeks),
        default_lead_weeks: parseInt(form.default_lead_weeks),
        active: !form.inactive,
      };
      delete payload.inactive;
      await apiCall(endpoint, {
        method: isEdit ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      await onRefresh();
      resetForm();
    } catch (err) {
      // error already set
    }
  }

  function startEdit(type) {
    setSelectedType(type);
    setForm({
      name: type.name || "",
      interval_weeks: type.interval_weeks?.toString() || "",
      rrule: type.rrule || "",
      default_lead_weeks: type.default_lead_weeks?.toString() || "",
      inactive: type.active !== undefined ? !type.active : false,
    });
  }

  async function handleDelete(typeId) {
    if (!window.confirm("Delete this equipment?")) return;
    try {
      await apiCall(`/equipment-types/${typeId}`, { method: "DELETE" });
      await onRefresh();
      if (selectedType?.id === typeId) resetForm();
    } catch (err) {
      // error already set
    }
  }

  async function handleSeed() {
    try {
      await apiCall("/equipment-types/seed", { method: "POST" });
      await onRefresh();
      setError("");
    } catch (err) {
      // error already set
    }
  }

  return (
    <div className="two-column">
      <div className="card">
        <div className="card-header">
          <h2>{selectedType ? "Edit Equipment" : "Add Equipment"}</h2>
          {selectedType && (
            <button className="secondary" onClick={resetForm}>+ New</button>
          )}
        </div>
        <form onSubmit={handleSubmit} className="form">
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
            Interval (weeks) *
            <input
              type="number"
              name="interval_weeks"
              value={form.interval_weeks}
              onChange={handleChange}
              required
            />
          </label>
          <label>
            RRULE *
            <input
              type="text"
              name="rrule"
              value={form.rrule}
              onChange={handleChange}
              placeholder="FREQ=WEEKLY;INTERVAL=13"
              required
            />
          </label>
          <label>
            Default Lead Weeks *
            <input
              type="number"
              name="default_lead_weeks"
              value={form.default_lead_weeks}
              onChange={handleChange}
              required
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              name="inactive"
              checked={form.inactive}
              onChange={handleChange}
            />
            Inactive
          </label>
          <button type="submit" className="primary">
            {selectedType ? "Save" : "Create"}
          </button>
        </form>
        <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid #8193A4" }}>
          <button className="secondary" onClick={handleSeed}>
            Seed Default Equipments
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Equipments ({equipmentTypes.length})</h2>
          <button className="secondary" onClick={onRefresh}>Refresh</button>
        </div>
        {equipmentTypes.length === 0 ? (
          <p className="empty">No equipments yet. Click "Seed Default Equipments" to add defaults.</p>
        ) : (
          <ul className="list">
            {equipmentTypes.map(type => (
              <li key={type.id} className="list-item">
                <div className="list-main">
                  <div className="list-title">{type.name}</div>
                  <div className="list-subtitle">
                    Every {type.interval_weeks} weeks • Lead: {type.default_lead_weeks} weeks
                    {!type.active && " • Inactive"}
                  </div>
                </div>
                <div className="list-actions">
                  <button onClick={() => startEdit(type)}>Edit</button>
                  <button className="danger" onClick={() => handleDelete(type.id)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

