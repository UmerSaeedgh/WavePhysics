import { useState } from "react";
import { formatDate } from "../utils/formatDate";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default function CalendarView({ items, currentUser, apiCall, onRefresh, onItemClick }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [dragItem, setDragItem] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [confirmDrag, setConfirmDrag] = useState(null); // { item, newDate }
  const [saving, setSaving] = useState(false);

  const isAdmin = currentUser && (currentUser.is_admin === true || currentUser.is_admin === 1);
  const isSuperAdmin = currentUser && (currentUser.is_super_admin === true || currentUser.is_super_admin === 1);
  const canDrag = isAdmin || isSuperAdmin;

  // Build a map of dateString -> items[]
  const itemsByDate = {};
  (items || []).forEach(item => {
    if (item.due_date) {
      const key = item.due_date;
      if (!itemsByDate[key]) itemsByDate[key] = [];
      itemsByDate[key].push(item);
    }
  });

  // Calendar grid
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDayOfWeek = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  const weeks = [];
  let currentWeek = [];
  // Fill leading empty cells
  for (let i = 0; i < startDayOfWeek; i++) {
    currentWeek.push(null);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    currentWeek.push(day);
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }
  // Fill trailing empty cells
  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) {
      currentWeek.push(null);
    }
    weeks.push(currentWeek);
  }

  const todayStr = toDateString(today);

  function prevMonth() {
    if (month === 0) {
      setMonth(11);
      setYear(year - 1);
    } else {
      setMonth(month - 1);
    }
  }

  function nextMonth() {
    if (month === 11) {
      setMonth(0);
      setYear(year + 1);
    } else {
      setMonth(month + 1);
    }
  }

  function goToToday() {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
  }

  // Drag handlers
  function handleDragStart(e, item) {
    if (!canDrag) return;
    setDragItem(item);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", item.id.toString());
  }

  function handleDragOver(e, dateStr) {
    if (!canDrag || !dragItem) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget(dateStr);
  }

  function handleDragLeave() {
    setDropTarget(null);
  }

  function handleDrop(e, dateStr) {
    e.preventDefault();
    setDropTarget(null);
    if (!canDrag || !dragItem) return;
    if (dragItem.due_date === dateStr) {
      setDragItem(null);
      return;
    }
    setConfirmDrag({ item: dragItem, newDate: dateStr });
    setDragItem(null);
  }

  function handleDragEnd() {
    setDragItem(null);
    setDropTarget(null);
  }

  async function handleConfirmReschedule() {
    if (!confirmDrag) return;
    setSaving(true);
    try {
      await apiCall(`/equipment-records/${confirmDrag.item.id}`, {
        method: "PUT",
        body: JSON.stringify({ due_date: confirmDrag.newDate })
      });
      setConfirmDrag(null);
      if (onRefresh) onRefresh();
    } catch (err) {
      // error is set by apiCall
    } finally {
      setSaving(false);
    }
  }

  function handleCancelReschedule() {
    setConfirmDrag(null);
  }

  function isOverdue(dateStr) {
    return dateStr < todayStr;
  }

  return (
    <div className="calendar-view">
      {/* Navigation */}
      <div className="calendar-nav">
        <button className="secondary" onClick={prevMonth} style={{ padding: "0.4rem 0.75rem", minWidth: "auto" }}>
          ←
        </button>
        <div className="calendar-nav-title">
          <h3 style={{ margin: 0 }}>{MONTH_NAMES[month]} {year}</h3>
          <button className="secondary" onClick={goToToday} style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem", minWidth: "auto" }}>
            Today
          </button>
        </div>
        <button className="secondary" onClick={nextMonth} style={{ padding: "0.4rem 0.75rem", minWidth: "auto" }}>
          →
        </button>
      </div>

      {/* Day headers */}
      <div className="calendar-grid calendar-header-row">
        {DAY_NAMES.map(name => (
          <div key={name} className="calendar-day-header">{name}</div>
        ))}
      </div>

      {/* Calendar body */}
      {weeks.map((week, wi) => (
        <div key={wi} className="calendar-grid calendar-week-row">
          {week.map((day, di) => {
            if (day === null) {
              return <div key={di} className="calendar-cell calendar-cell-empty" />;
            }
            const dateStr = toDateString(new Date(year, month, day));
            const dayItems = itemsByDate[dateStr] || [];
            const isToday = dateStr === todayStr;
            const isDropHere = dropTarget === dateStr;
            const overdueDay = isOverdue(dateStr);

            return (
              <div
                key={di}
                className={`calendar-cell${isToday ? " calendar-cell-today" : ""}${isDropHere ? " calendar-cell-drop" : ""}`}
                onDragOver={(e) => handleDragOver(e, dateStr)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, dateStr)}
              >
                <div className={`calendar-date-number${isToday ? " calendar-date-today" : ""}`}>
                  {day}
                </div>
                <div className="calendar-items">
                  {dayItems.map(item => (
                    <div
                      key={item.id}
                      className={`calendar-item${overdueDay ? " calendar-item-overdue" : ""}`}
                      draggable={canDrag}
                      onDragStart={(e) => handleDragStart(e, item)}
                      onDragEnd={handleDragEnd}
                      onClick={() => onItemClick && onItemClick(item)}
                      title={`${item.equipment_name}${item.client_name ? " - " + item.client_name : ""}${item.site_name ? " (" + item.site_name + ")" : ""}`}
                      style={{ cursor: canDrag ? "grab" : "pointer" }}
                    >
                      <span className="calendar-item-name">{item.equipment_name}</span>
                      {item.client_name && (
                        <span className="calendar-item-client">{item.client_name}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {/* Legend */}
      <div className="calendar-legend">
        <div className="calendar-legend-item">
          <span className="calendar-legend-dot" style={{ backgroundColor: "#8193A4" }}></span>
          <span>Upcoming</span>
        </div>
        <div className="calendar-legend-item">
          <span className="calendar-legend-dot" style={{ backgroundColor: "#d32f2f" }}></span>
          <span>Overdue</span>
        </div>
        {canDrag && (
          <div className="calendar-legend-item" style={{ marginLeft: "auto", fontSize: "0.8rem", color: "#666" }}>
            Drag a test to another date to reschedule
          </div>
        )}
      </div>

      {/* Confirm reschedule modal */}
      {confirmDrag && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(45, 50, 52, 0.9)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000
        }} onClick={handleCancelReschedule}>
          <div style={{
            backgroundColor: "#D7E5D8",
            padding: "2rem",
            borderRadius: "0.5rem",
            maxWidth: "450px",
            width: "90%",
            color: "#2D3234"
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
              <h3 style={{ margin: 0, color: "#2D3234" }}>Reschedule Test</h3>
              <button onClick={handleCancelReschedule} style={{ color: "#2D3234", border: "1px solid #8193A4" }}>✕</button>
            </div>
            <p style={{ margin: "0 0 1rem 0" }}>
              Are you sure you want to reschedule <strong>{confirmDrag.item.equipment_name}</strong>?
            </p>
            <div style={{ display: "flex", gap: "1rem", alignItems: "center", justifyContent: "center", margin: "1rem 0" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "0.8rem", color: "#666", marginBottom: "0.25rem" }}>From</div>
                <div style={{ fontWeight: "bold", color: "#d32f2f", fontSize: "1.05rem" }}>{formatDate(confirmDrag.item.due_date)}</div>
              </div>
              <div style={{ fontSize: "1.5rem", color: "#8193A4" }}>→</div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "0.8rem", color: "#666", marginBottom: "0.25rem" }}>To</div>
                <div style={{ fontWeight: "bold", color: "#10b981", fontSize: "1.05rem" }}>{formatDate(confirmDrag.newDate)}</div>
              </div>
            </div>
            {confirmDrag.item.client_name && (
              <p style={{ margin: "0.5rem 0 0 0", fontSize: "0.9rem", color: "#666" }}>
                Client: {confirmDrag.item.client_name}
                {confirmDrag.item.site_name && ` • Site: ${confirmDrag.item.site_name}`}
              </p>
            )}
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1.5rem" }}>
              <button className="secondary" onClick={handleCancelReschedule} disabled={saving}>
                Cancel
              </button>
              <button className="primary" onClick={handleConfirmReschedule} disabled={saving}>
                {saving ? "Saving..." : "Reschedule"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
