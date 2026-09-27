function frameUrl() {
  const url = new URL(window.location.href)
  url.searchParams.set('markerFrame', '1')
  return `${url.pathname}${url.search}${url.hash}`
}

export function DesktopFrame() {
  const src = frameUrl()
  return <div className="desktop-frame-shell">
    <iframe
      className="desktop-frame"
      src={src}
      title="Маркер — мобильное приложение"
      allow="camera; geolocation; accelerometer; gyroscope; magnetometer; screen-wake-lock; xr-spatial-tracking; fullscreen"
    />
    <a className="desktop-frame__open" href={src} target="_blank" rel="noopener noreferrer">Открыть отдельно</a>
  </div>
}
