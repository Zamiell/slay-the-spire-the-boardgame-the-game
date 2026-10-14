import { createCampaignProgress, MAX_ASCENSION, parseCampaignProgress, type CampaignProgress } from './game/campaign.ts'

export const CAMPAIGN_KEY = 'sts-physical-campaign'

export function savedCampaign(): CampaignProgress {
  try { return parseCampaignProgress(JSON.parse(localStorage.getItem(CAMPAIGN_KEY) ?? '{}')) }
  catch { return createCampaignProgress() }
}

export function saveAscensionUnlock(level: number) {
  if (!Number.isInteger(level) || level < 0 || level > MAX_ASCENSION) return
  const progress = savedCampaign()
  if (level <= progress.highestAscension) return
  try {
    localStorage.setItem(CAMPAIGN_KEY, JSON.stringify({ ...progress, highestAscension: level }))
  } catch { /* Keep the room playable when browser storage is unavailable. */ }
}
