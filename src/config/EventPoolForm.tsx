import { useState } from "react";
import type { Catalog } from "../domain/types";

type Record_ = Record<string, unknown>;

export function EventPoolForm({
  record,
  catalog,
  onChange,
}: {
  record: Record_;
  catalog: Catalog;
  onChange: (next: Record_) => void;
}) {
  const [query, setQuery] = useState("");
  const selected = Array.isArray(record.eventIds)
    ? record.eventIds.filter((id): id is string => typeof id === "string")
    : [];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const events = Object.values(catalog.events)
    .filter((event) =>
      normalizedQuery
        ? `${event.title} ${event.id} ${event.description}`
            .toLocaleLowerCase()
            .includes(normalizedQuery)
        : true,
    )
    .sort((left, right) => {
      const selectedDelta =
        Number(selected.includes(right.id)) -
        Number(selected.includes(left.id));
      return selectedDelta || left.title.localeCompare(right.title, "zh-CN");
    });

  function toggle(eventId: string, checked: boolean): void {
    const next = checked
      ? [...selected.filter((id) => id !== eventId), eventId]
      : selected.filter((id) => id !== eventId);
    onChange({ ...record, eventIds: next });
  }

  return (
    <div className="config-form config-event-pool-form">
      <section className="config-event-outcomes">
        <strong>抽取规则</strong>
        <p>
          节点抵达时，从所有关联事件池的可用事件中等概率抽取一个。事件自身的次要属性门槛会先过滤不可用事件。
        </p>
      </section>
      <label className="config-field">
        <span>搜索事件</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="输入事件名称、ID 或描述"
        />
        <small>已选择 {selected.length} 个事件；事件池至少需要一个事件。</small>
      </label>
      <div className="config-task-check-grid config-event-pool-list">
        {events.map((event) => (
          <label className="config-check" key={event.id}>
            <input
              type="checkbox"
              checked={selected.includes(event.id)}
              onChange={(input) => toggle(event.id, input.target.checked)}
            />
            <span>{event.title}</span>
            <small>
              {event.id} · {event.choices.length} 个选项
            </small>
          </label>
        ))}
        {!events.length && <p className="config-form-note">没有匹配的事件。</p>}
      </div>
    </div>
  );
}
