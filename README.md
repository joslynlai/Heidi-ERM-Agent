# Heidi EMR Agent

The missing bridge between Heidi's AI scribing and your EMR system.

**Heidi EMR Agent** is a Chrome Extension side panel that intelligently automates the data entry workflow from Heidi Health notes into OpenEMR and any web-based EMR.

## 💡 Inspiration

**The Pain Point:** Heidi Health generates incredible AI scribe notes, but doctors still face the tedious "last mile" problem: manually copying, pasting, and reformatting this data into their EMR system. This manual transfer breaks flow, wastes time, and increases the risk of data entry errors.

**Our Solution:** We built an intelligent agent that lives right inside the browser, bridging the gap between Heidi's generated content and the doctor's system of record.

## 🚀 What It Does

For this hackathon, we focused on a high-value, specific use case: **Automating the Patient Encounter & Consultation Note workflow in OpenEMR.**

While built for OpenEMR today, our architecture is **EMR-agnostic**. The agent:
1. **Scans** the current EMR page to understand its structure.
2. **Maps** the Heidi note content to the relevant EMR fields dynamically.
3. **Navigates** complex EMR workflows (e.g., saving an encounter, opening a SOAP form, filling it, and saving again).

Doctors can simply open the side panel, and click "Run Workflow." The agent handles the rest.

## 🛠️ How We Built It

We architected a **hybrid AI/Workflow Conduct system** delivered as a Chrome Extension Side Panel (Manifest V3).

### Workflow Architecture
- **The Brain (Gemini AI):** We use Google's Gemini 2.5 Pro model to handle the "messy" part—mapping unstructured clinical text to structured form fields. It understands context (e.g., "Reason for Visit" vs. "Assessment") and formats data appropriately.
- **The Hands (DOM Automation):** A robust execution engine runs content scripts that can see into iframes, click buttons, and fill inputs.
- **The Logic (Hybrid Workflows):** We combine:
  - **Workflow Navigation:** Reliable, fast rules for clicking buttons and menus (which rarely change).
  - **Dynamic AI Filling:** Intelligent, on-the-fly field mapping for patient data (which changes every time).

### Tech Stack
- **Frontend:** React, TypeScript, Vite
- **Extension:** Chrome Manifest V3 (Side Panel API, Scripting API)
- **AI:** Google Gemini 2.5 Pro (via AI Studio API)
- **Target System:** OpenEMR (Open Source EMR)

## 🚧 Challenges We Ran Into

**Teaching the Agent to Navigate:**
The hardest part was designing how the agent "learns" a workflow. Fully autonomous agents (that look at screenshots) are often slow and fragile.
- *Solution:* We adopted a **"Human-Guided, AI-Executed"** approach. We defined a structured workflow format (`WorkflowStep`) that guides the agent through the critical path (navigation/saving), while letting the AI handle the dynamic data entry parts autonomously.

**The "Iframe Wall":**
OpenEMR (like many legacy EMRs) heavily uses iframes. Our initial scanner was blind to the actual forms.
- *Solution:* We engineered a multi-frame scanner that injects scripts into every frame, aggregates the results, and executes actions in the correct context.

## 📈 Cost & Scalability

**Zero-Shot Efficiency:**
Unlike vision-based agents that require expensive screenshot processing for every step, our DOM-based approach is **text-only**.
- **Low Latency:** Actions happen immediately in the browser.
- **Low Cost:** We only send text prompts to Gemini, saving massive token costs compared to multimodal models.

**Human-Labeled Workflows:**
By defining workflows as code/config (rather than training a model to "guess" navigation), we ensure 100% reliability for critical actions like "Save" while retaining the flexibility of AI for data entry. This makes the system scalable to new EMRs simply by defining a new workflow config file.

## Setup & Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Build the extension:**
   ```bash
   npm run build
   ```

3. **Load in Chrome:**
   - Open `chrome://extensions`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist` folder

4. **Configure API Key:**
   - Get a free API Key from [Google AI Studio](https://aistudio.google.com/)
   - Enter it in the extension settings

## Team

Built with ❤️ for the Heidi Health Hackathon.
