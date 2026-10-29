import { WelcomeScreen } from './ui/WelcomeScreen.tsx'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App.tsx'
import './ui/styles.css'
// The frame around the board. Loaded second so its plain-selector rules win
// ties against the board stylesheet on purpose; see the header of chrome.css.
import './ui/chrome.css'
import './ui/styles/welcome.css'
import { checkStanding } from './profile.ts'

const container = document.getElementById('root')
if (!container) throw new Error('#root element is missing from index.html')

const preventContextMenu = (event: MouseEvent) => event.preventDefault()
document.addEventListener('contextmenu', preventContextMenu)
import.meta.hot?.dispose(() => document.removeEventListener('contextmenu', preventContextMenu))

void checkStanding()

createRoot(container).render(
  <StrictMode>
    <WelcomeScreen><App /></WelcomeScreen>
  </StrictMode>,
)
