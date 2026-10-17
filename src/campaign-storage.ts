import { createCampaignProgress, MAX_ASCENSION, parseCampaignProgress, type CampaignProgress } from './game/campaign.ts'
import { ACCOUNT_SERVER, normalizeUsername, savedProfile, syncProfileAscension } from './profile.ts'

export const CAMPAIGN_KEY = 'sts-physical-campaign'
export const CAMPAIGN_EVENT = 'sts-campaign-change'
export const campaignKey = (): string => {
  const profile = savedProfile()
  return ACCOUNT_SERVER && profile ? `${CAMPAIGN_KEY}:${normalizeUsername(profile.username)}` : CAMPAIGN_KEY
}
const unsaved = new Map<string, { progress: CampaignProgress; stored: string | null | undefined }>()
let legacyOwner: string | undefined

export function savedCampaign(): CampaignProgress {
  const key = campaignKey()
  const pending = unsaved.get(key)
  try {
    const stored = localStorage.getItem(key)
    let value = stored
    if (key !== CAMPAIGN_KEY && value === null && (legacyOwner === undefined || legacyOwner === key)) {
      value = localStorage.getItem(CAMPAIGN_KEY)
      if (value !== null) {
        legacyOwner = key
        // Move the old browser journal to its first account; another login must not inherit it.
        try {
          localStorage.setItem(key, value)
          localStorage.removeItem(CAMPAIGN_KEY)
        } catch { unsaved.set(key, { progress: parseCampaignProgress(JSON.parse(value)), stored }) }
      }
    }
    const durable = parseCampaignProgress(JSON.parse(value ?? '{}'))
    if (!pending) return durable
    if (pending.stored === undefined || pending.stored === stored) return pending.progress
    // A newer durable journal wins; retain only the unsaved Ascension floor.
    const progress = { ...durable, highestAscension: Math.max(durable.highestAscension, pending.progress.highestAscension) }
    if (progress.highestAscension === durable.highestAscension) unsaved.delete(key)
    else unsaved.set(key, { progress, stored })
    return progress
  } catch { return pending?.progress ?? createCampaignProgress() }
}

export function saveCampaign(progress: CampaignProgress) {
  const key = campaignKey()
  const previous = savedCampaign()
  const journal = { ...progress, highestAscension: Math.max(previous.highestAscension, progress.highestAscension) }
  let stored: string | null | undefined
  try {
    stored = localStorage.getItem(key)
    localStorage.setItem(key, JSON.stringify(journal))
    unsaved.delete(key)
  } catch { unsaved.set(key, { progress: journal, stored }) }
  if (journal.highestAscension !== previous.highestAscension) window.dispatchEvent(new Event(CAMPAIGN_EVENT))
}

export function saveAscensionUnlock(level: number) {
  if (!Number.isInteger(level) || level < 0 || level > MAX_ASCENSION) return
  const progress = savedCampaign()
  if (level > progress.highestAscension) saveCampaign({ ...progress, highestAscension: level })
}

const syncing = new Map<string, Promise<void>>()
export async function syncAccountAscension(): Promise<void> {
  const profile = savedProfile()
  if (!ACCOUNT_SERVER || !profile) return
  const previous = syncing.get(profile.token)
  if (previous) return previous
  const request = (async () => {
    let uploaded: number
    do {
      const highestAscension = savedCampaign().highestAscension
      const reply = await syncProfileAscension(profile, highestAscension)
      if (savedProfile()?.token !== profile.token) return
      saveAscensionUnlock(reply.highestAscension)
      uploaded = Math.max(highestAscension, reply.highestAscension)
    } while (savedCampaign().highestAscension > uploaded)
  })().finally(() => syncing.delete(profile.token))
  syncing.set(profile.token, request)
  return request
}
