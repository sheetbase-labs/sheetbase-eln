/**
 * How a finished step timer gets your attention on this device: a browser
 * notification (through the service worker where the browser needs one, as
 * phones do), a vibration and a short beep. Everything here is best effort;
 * a browser that refuses one still gets the others, and the page always shows
 * the timer as finished.
 */
import { t } from '#/copy'

const ALERTED_KEY = 'sheetbase.stepTimers.alerted'
const MAX_REMEMBERED = 50

/** Ids already alerted on this device, shared by every tab of the app. */
function readAlerted(): string[] {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(ALERTED_KEY) ?? '[]',
    )

    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : []
  } catch {
    return []
  }
}

/** True the first time a timer is claimed on this device, false after. */
export function claimAlert(timerId: string): boolean {
  const seen = readAlerted()

  if (seen.includes(timerId)) return false

  try {
    localStorage.setItem(
      ALERTED_KEY,
      JSON.stringify([...seen, timerId].slice(-MAX_REMEMBERED)),
    )
  } catch {
    // Storage unavailable (private window): the alert still fires, maybe twice.
  }

  return true
}

export function notificationPermission():
  NotificationPermission | 'unsupported' {
  return typeof Notification === 'undefined'
    ? 'unsupported'
    : Notification.permission
}

/** Ask once, from the tap that starts a timer, and ready the service worker. */
export async function prepareTimerAlerts(): Promise<void> {
  if (typeof window === 'undefined') return

  try {
    if (
      typeof Notification !== 'undefined' &&
      Notification.permission === 'default'
    ) {
      await Notification.requestPermission()
    }

    if ('serviceWorker' in navigator) {
      await navigator.serviceWorker.register('/sw.js')
    }
  } catch {
    // The timer still counts down and shows on the page.
  }
}

async function showNotification(
  timerId: string,
  label: string,
  url: string,
): Promise<void> {
  if (notificationPermission() !== 'granted') return

  const options: NotificationOptions & { vibrate?: number[] } = {
    body: label,
    tag: `step-timer-${timerId}`,
    icon: '/icon-192.png',
    data: { url },
    vibrate: [300, 150, 300, 150, 300],
    requireInteraction: true,
  }

  const title = t('notebook.stepTimers.finishedTitle')

  try {
    const registration =
      'serviceWorker' in navigator
        ? await navigator.serviceWorker.getRegistration()
        : undefined

    if (registration) {
      await registration.showNotification(title, options)

      return
    }

    new Notification(title, options)
  } catch {
    // Some browsers only allow the service worker route; nothing else to try.
  }
}

function beep(): void {
  try {
    const audio = window as unknown as {
      AudioContext?: typeof AudioContext
      webkitAudioContext?: typeof AudioContext
    }

    const Context = audio.AudioContext ?? audio.webkitAudioContext

    if (!Context) return
    const context = new Context()
    const start = context.currentTime

    for (let i = 0; i < 3; i += 1) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.frequency.value = 880
      gain.gain.setValueAtTime(0.0001, start + i * 0.4)
      gain.gain.exponentialRampToValueAtTime(0.25, start + i * 0.4 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + i * 0.4 + 0.3)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start(start + i * 0.4)
      oscillator.stop(start + i * 0.4 + 0.32)
    }

    window.setTimeout(() => void context.close(), 1800)
  } catch {
    // A page that has not been touched yet may not be allowed to play sound.
  }
}

/** Alert for one finished timer. Call only after `claimAlert` returned true. */
export async function alertTimerFinished(
  timerId: string,
  label: string,
  url: string,
): Promise<void> {
  try {
    ;(navigator as { vibrate?: (pattern: number[]) => boolean }).vibrate?.([
      300, 150, 300, 150, 300,
    ])
  } catch {
    // Not every browser vibrates.
  }

  beep()
  await showNotification(timerId, label, url)
}
