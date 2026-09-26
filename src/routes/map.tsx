import { createFileRoute } from '@tanstack/react-router'
import { MapPanel } from '../modules/map'
export const Route = createFileRoute('/map')({ component: MapPanel })
