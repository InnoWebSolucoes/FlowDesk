import { useEffect, useRef } from 'react'
import { useProjectStore } from '../store/projectStore'

/**
 * Clicking the circle on a todo, the same way everywhere it appears.
 *
 * On the managers' shared board a click marks the todo as waiting on
 * somebody else, and a double click skips that and marks it done. The first
 * click is held for a moment so a second one can turn it into "done"
 * instead — otherwise a double click would land as waiting-then-done, which
 * is right by accident and looks like a flicker. A done todo reopens on one
 * click. Anyone else's todo simply ticks and unticks.
 */
const DOUBLE_CLICK_MS = 350

export function useTodoTick() {
  const { todos, setTodoState, toggleTodo } = useProjectStore()
  const pending = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    const map = pending.current
    return () => { map.forEach(clearTimeout); map.clear() }
  }, [])

  return (id: string) => {
    const todo = todos.find((t) => t.id === id)
    if (!todo) return
    if (todo.ownerId !== null) {
      toggleTodo(id)
      return
    }
    if (todo.isCompleted) {
      setTodoState(id, 'open')
      return
    }
    const held = pending.current.get(id)
    if (held) {
      clearTimeout(held)
      pending.current.delete(id)
      setTodoState(id, 'done')
      return
    }
    pending.current.set(id, setTimeout(() => {
      pending.current.delete(id)
      setTodoState(id, todo.waitingSince ? 'done' : 'waiting')
    }, DOUBLE_CLICK_MS))
  }
}
