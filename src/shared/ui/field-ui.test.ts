import { beforeEach, expect, test } from 'vitest'
import { useFieldUi } from './field-ui'

beforeEach(() => useFieldUi.setState({ view: 'sector', drawer: 'survey', expanded: false }))

test('switching field views closes the point drawer and collapses the dock', () => {
  const { setDrawer, setView } = useFieldUi.getState()
  setDrawer('point')
  expect(useFieldUi.getState()).toMatchObject({ drawer: 'point', expanded: true })
  setView('bottom')
  expect(useFieldUi.getState()).toMatchObject({ view: 'bottom', drawer: 'survey', expanded: false })
})
