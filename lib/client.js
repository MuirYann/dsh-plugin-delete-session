/**
 * dsh-session-delete — client half.
 *
 * Adds a Delete row to the shipped session menu (pin 100 / rename 200 / fork
 * 300 / archive 400, so order 500 lands below them) plus the confirmation it
 * raises in the frame-wide overlay layer.
 *
 * Deliberately minimal wiring: a boot audit kills the whole page when one
 * entry fails to activate, so
 *   - the two registrations are isolated, and neither can take the other down;
 *   - the pending request lives in a plain observable read through React's own
 *     `useSyncExternalStore`, so no slot-store binding has to line up;
 *   - the menu row takes only owner props and framework-made hooks.
 *
 * The browser cannot touch session files, so the confirmed action posts to the
 * host half's namespaced route over same-origin `fetch`; the Host owns
 * authentication for that origin.
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-delete',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { IconTrashOutlineRegular, MenuItemButton } = require('@deepseek-ai/dsh-client-ui-primitives')

    /** Locale namespace owned by this package. */
    const NS = 'session-delete'
    /** Host route registered by this plugin's host half. */
    const ROUTE = '/dsh-session-delete'

    const zh = {
      'menu.deleteSession': '删除会话',
      'delete.confirm.title': '删除会话',
      'delete.confirm.desc': '将永久删除「{title}」：会话日志、投影缓存与工作区归属都会一并清除，无法撤销。',
      'delete.confirm.action': '删除',
      'delete.confirm.pending': '正在删除…',
      'delete.confirm.failed': '删除失败：{message}',
      'cancel': '取消',
      'close': '关闭',
    }

    const en = {
      'menu.deleteSession': 'Delete session',
      'delete.confirm.title': 'Delete session',
      'delete.confirm.desc': 'This permanently removes "{title}": its log, projection cache, and workspace accounting all go with it. It cannot be undone.',
      'delete.confirm.action': 'Delete',
      'delete.confirm.pending': 'Deleting…',
      'delete.confirm.failed': 'Delete failed: {message}',
      'cancel': 'Cancel',
      'close': 'Close',
    }

    /** Services this plugin reads; both are part of the shipped client baseline. */
    const inject = ['slots', 'locale']

    /** One pending confirmation, without pulling in a store engine. */
    function createPending() {
      let value = null
      const listeners = new Set()
      return {
        get: () => value,
        set: (next) => {
          value = next
          for (const listener of [...listeners]) listener()
        },
        subscribe: (listener) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      }
    }

    const pending = createPending()

    /**
     * One menu row: opens the confirmation for the row it belongs to.
     *
     * Uses the shipped menu primitive, which is what the rows above it use, so
     * geometry, icon slot, hover and the list's keyboard walk match by
     * construction; `danger` is the primitive's own destructive tint, which
     * makes the label red rather than the neutral row colour.
     */
    function SessionDeleteMenuItem({ sessionId, displayTitle, useMenuOpenState, t }) {
      const [, setMenuOpen] = useMenuOpenState()
      const label = typeof t === 'function' ? t('menu.deleteSession') : 'Delete session'
      return React.createElement(
        MenuItemButton,
        {
          danger: true,
          icon: React.createElement(IconTrashOutlineRegular, { size: 14 }),
          onSelect: () => {
            setMenuOpen(false)
            pending.set({
              sessionId,
              displayTitle: typeof displayTitle === 'string' ? displayTitle : '',
            })
          },
        },
        label,
      )
    }

    /** The confirmation, mounted for the page's lifetime and idle when empty. */
    function SessionDeleteDialog({ t }) {
      const request = React.useSyncExternalStore(pending.subscribe, pending.get, pending.get)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)

      if (request === null) return null

      const label = (key, fallback, params) => (typeof t === 'function' ? t(key, params) : fallback)
      const close = () => {
        if (busy) return
        setError(null)
        pending.set(null)
      }
      const confirm = () => {
        setBusy(true)
        setError(null)
        fetch(ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: request.sessionId }),
        }).then(async (response) => {
          const body = await response.json().catch(() => null)
          setBusy(false)
          if (!response.ok || body?.ok !== true) {
            setError(body?.message ?? String(response.status))
            return
          }
          pending.set(null)
        }).catch((reason) => {
          setBusy(false)
          setError(reason instanceof Error ? reason.message : String(reason))
        })
      }

      const title = request.displayTitle === '' ? request.sessionId : request.displayTitle
      return React.createElement(
        'div',
        {
          role: 'dialog',
          'aria-modal': 'true',
          style: {
            position: 'fixed', inset: '0', zIndex: 2147483000,
            display: 'grid', placeItems: 'center',
            background: 'var(--dsw-alias-bg-mask-2, rgb(0 0 0 / 32%))',
            pointerEvents: 'auto',
          },
          onClick: close,
        },
        React.createElement(
          'div',
          {
            onClick: (event) => { event.stopPropagation() },
            style: {
              minWidth: 'min(420px, 90vw)', maxWidth: '520px',
              padding: '20px 22px 16px',
              borderRadius: '12px',
              background: 'var(--dsw-alias-bg-overlay, #ffffff)',
              color: 'var(--dsw-alias-label-primary, #0f1115)',
              border: '0.5px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 10%))',
              boxShadow: '0 18px 44px rgb(0 0 0 / 26%)',
            },
          },
          React.createElement('div', { style: { fontSize: '15px', fontWeight: 600, marginBottom: '8px' } },
            label('delete.confirm.title', 'Delete session')),
          React.createElement('div', { style: { fontSize: '13px', lineHeight: 1.7, color: 'var(--dsw-alias-label-secondary, #3c3c3d)' } },
            label('delete.confirm.desc', 'This permanently removes the session.', { title })),
          busy ? React.createElement('div', { role: 'status', style: { marginTop: '10px', fontSize: '12px' } },
            label('delete.confirm.pending', 'Deleting…')) : null,
          error === null ? null : React.createElement('div', { role: 'alert', style: { marginTop: '10px', fontSize: '12px', color: 'var(--dsw-alias-state-error-primary, #d92d20)' } },
            label('delete.confirm.failed', 'Delete failed: ' + error, { message: error })),
          React.createElement(
            'div',
            { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' } },
            React.createElement('button', {
              type: 'button', disabled: busy, onClick: close,
              style: {
                padding: '6px 14px', borderRadius: '8px', cursor: 'pointer', font: 'inherit',
                border: '0.5px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 16%))',
                background: 'transparent', color: 'inherit',
              },
            }, label('cancel', 'Cancel')),
            React.createElement('button', {
              type: 'button', disabled: busy, onClick: confirm,
              style: {
                padding: '6px 14px', borderRadius: '8px', cursor: 'pointer', font: 'inherit',
                border: '0.5px solid transparent',
                background: 'var(--dsw-alias-state-error-primary, #d92d20)', color: '#fff',
              },
            }, label('delete.confirm.action', 'Delete')),
          ),
        ),
      )
    }

    /**
     * Register the dictionaries, then each surface independently: a failure in
     * one registration must not prevent the other from mounting, and must not
     * leave the plugin's entry inactive.
     * @param ctx - client cordis context.
     */
    function apply(ctx) {
      try {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-session-delete: dictionaries')
      } catch (error) {
        ctx.logger?.warn?.('dsh-session-delete: dictionary registration failed', error)
      }

      try {
        ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register(
          { name: 'sidebar.workspaces.session.menu.item', id: 'session-delete', order: 500, locale: NS },
          SessionDeleteMenuItem,
        ))
      } catch (error) {
        ctx.logger?.error?.('dsh-session-delete: menu row registration failed', error)
      }

      try {
        ctx.slots.inject('shell.overlay', function* () {
          yield ctx.slots.register(
            { name: 'shell.overlay', id: 'session-delete-confirm', locale: NS },
            SessionDeleteDialog,
          )
        })
      } catch (error) {
        ctx.logger?.error?.('dsh-session-delete: dialog registration failed', error)
      }
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
