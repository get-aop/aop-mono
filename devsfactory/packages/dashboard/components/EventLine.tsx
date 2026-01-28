export interface ActivityEvent {
  timestamp: Date;
  agentId: string;
  action: string;
}

interface EventLineProps {
  event: ActivityEvent;
  isActive: boolean;
  onClick?: () => void;
}

const formatTime = (date: Date): string => {
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
};

export const EventLine = ({ event, isActive, onClick }: EventLineProps) => (
  <button
    type="button"
    className={`event-line ${isActive ? "active" : ""}`}
    onClick={onClick}
  >
    <span className="event-timestamp">{formatTime(event.timestamp)}</span>
    <span className={`event-indicator ${isActive ? "active" : ""}`}>●</span>
    <span className="event-agent">{event.agentId}</span>
    <span className="event-action">{event.action}</span>
  </button>
);
