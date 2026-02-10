import { useEffect, useState } from "react";

export const ElectronTitleBar = () => {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!window.electronAPI) {
      return;
    }

    window.electronAPI.isMaximized().then(setIsMaximized);
  }, []);

  const handleMaximize = () => {
    if (window.electronAPI) {
      window.electronAPI.maximizeWindow();
      setIsMaximized(!isMaximized);
    }
  };

  const handleMinimize = () => {
    if (window.electronAPI) {
      window.electronAPI.minimizeWindow();
    }
  };

  const handleClose = () => {
    if (window.electronAPI) {
      window.electronAPI.closeWindow();
    }
  };

  const isMacOS = navigator.platform.startsWith("Mac");

  return (
    <div className="electron-titlebar">
      <div className="titlebar-left">
        <svg
          className="titlebar-icon"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label="AOP"
        >
          <title>AOP</title>
          <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="#d97706" />
          <path
            d="M2 17L12 22L22 17"
            stroke="#d97706"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M2 12L12 17L22 12"
            stroke="#d97706"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="titlebar-text">AOP Desktop</span>
      </div>
      {!isMacOS && (
        <div className="titlebar-controls">
          <button
            type="button"
            className="titlebar-btn btn-minimize"
            onClick={handleMinimize}
            title="Minimize"
          >
            <svg viewBox="0 0 16 16" role="img" aria-label="Minimize">
              <title>Minimize</title>
              <path
                d="M4 8h8"
                stroke="rgba(255,255,255,0.7)"
                strokeWidth="1.5"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </button>
          <button
            type="button"
            className="titlebar-btn btn-maximize"
            onClick={handleMaximize}
            title={isMaximized ? "Restore" : "Maximize"}
          >
            <svg viewBox="0 0 16 16" role="img" aria-label={isMaximized ? "Restore" : "Maximize"}>
              <title>{isMaximized ? "Restore" : "Maximize"}</title>
              {isMaximized ? (
                <g>
                  <rect
                    x="4"
                    y="4"
                    width="7"
                    height="7"
                    rx="1.5"
                    stroke="rgba(255,255,255,0.7)"
                    strokeWidth="1.5"
                    fill="none"
                  />
                  <rect
                    x="5"
                    y="5"
                    width="7"
                    height="7"
                    rx="1.5"
                    stroke="rgba(255,255,255,0.7)"
                    strokeWidth="1.5"
                    fill="none"
                  />
                </g>
              ) : (
                <rect
                  x="3.5"
                  y="3.5"
                  width="9"
                  height="9"
                  rx="1.5"
                  stroke="rgba(255,255,255,0.7)"
                  strokeWidth="1.5"
                  fill="none"
                />
              )}
            </svg>
          </button>
          <button
            type="button"
            className="titlebar-btn btn-close"
            onClick={handleClose}
            title="Close"
          >
            <svg viewBox="0 0 16 16" role="img" aria-label="Close">
              <title>Close</title>
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="rgba(255,255,255,0.7)"
                strokeWidth="1.5"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
};
