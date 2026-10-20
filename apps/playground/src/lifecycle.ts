/** Saving can be cancelled, fail, or finish after another edit; all keep the window open. */
export async function mayLeaveDocument(dirty: () => boolean,
  confirm: () => Promise<'save' | 'discard' | 'cancel'>, save: () => Promise<boolean>, discard: () => void = () => {}): Promise<boolean> {
  if (!dirty()) return true
  const decision = await confirm()
  if (decision === 'discard') { discard(); return true }
  if (decision !== 'save') return false
  return await save() && !dirty()
}
