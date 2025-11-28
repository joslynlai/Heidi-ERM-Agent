// Background service worker for Heidi EMR Agent

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel.open({ tabId: tab.id })
  }
})

// Set side panel behavior
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })

