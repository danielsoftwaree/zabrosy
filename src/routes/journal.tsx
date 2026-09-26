import { createFileRoute } from '@tanstack/react-router'
import { JournalPanel } from '../modules/journal'
export const Route = createFileRoute('/journal')({ component: JournalPanel })
