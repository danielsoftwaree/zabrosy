import { createFileRoute } from '@tanstack/react-router'
import { DevicePanel } from '../modules/map/device-panel'

export const Route = createFileRoute('/device')({ component: DevicePage })

function DevicePage() {
  return <div className="page"><h1>Устройство</h1><DevicePanel /></div>
}
