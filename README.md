# TrueClaim

**An Intelligent, Explainable Healthcare Claims Audit Assistant**

[![View Live Demo](https://img.shields.io/badge/View_Live_Demo-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://true-claim.vercel.app/) 
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Krypto-Knight-05/TrueClaim)

## 📌 The Problem
In the healthcare industry, billions are lost to fraud because traditional systems only check if the billing numbers add up—they don't read the narrative. A $5,000 claim for a "complex surgery" might get approved instantly because the CPT code looks valid, even if the doctor's notes only describe a routine checkup. 

## 💡 Our Solution
TrueClaim acts as a "second pair of eyes" for claims investigators. Using a high-performance Next.js Serverless architecture and the Gemini 2.0 Flash model, TrueClaim cross-references itemized medical bills against unstructured clinical notes to catch sophisticated fraud, upcoding, and impossible temporal patterns that rule-based engines miss.

---

## 🚀 Key Features

* **🩺 Automated Clinical Verification:** Instantly detects "Severity Mismatches." If a hospital bills for Level 5 Critical Care but the OCR extracts "Vitals Stable" from the doctor's PDF, the system flags the upcoding attempt.
* **⏱️ The Timeline Detective (Physics Engine):** A custom Spatio-Temporal engine that uses interval-math and the Haversine formula to map claims. If a patient is billed for procedures in two different cities requiring them to travel at 1,000 km/h, it triggers a "Teleportation" alert.
* **👻 Financial Integrity Checks:** Utilizes $O(1)$ Set Operations against the NCCI database to catch unbundled charges, alongside semantic matching to hunt down "Ghost Services" (items billed but not mentioned in clinical reports).
* **🔍 The "Glass Box" Dashboard:** Eliminates "Black Box" AI. The UI draws responsive red bounding boxes directly over the offending sentences in the medical PDF and generates human-readable audit briefs explaining exactly *why* a claim was flagged.

---

## 🛠️ Tech Stack (MVP)

* **Frontend:** Next.js 15 (App Router), React, Tailwind CSS, Recharts/D3.js (Gantt & Waterfall charts), React-PDF-Highlighter.
* **Backend:** Next.js Serverless API Routes (TypeScript).
* **AI & NLP:** Gemini 2.0 Flash (via MegaLLM API) for narrative generation and heuristics.
* **OCR:** Client-side Tesseract.js (WASM worker) with bounding box coordinate mapping.
* **Data Processing:** PapaParse (CSV), custom ISO-8601 Temporal Normalization.

---

## 💻 Getting Started (Local Development)

### 1. Clone the repository
\`\`\`bash
git clone https://github.com/Krypto-Knight-05/TrueClaim.git
cd TrueClaim
\`\`\`

### 2. Install dependencies
\`\`\`bash
npm install
\`\`\`

### 3. Set up Environment Variables
Create a \`.env.local\` file in the root directory and add your Google Gemini API key:
\`\`\`env
GEMINI_API_KEY=your_api_key_here
\`\`\`

### 4. Run the development server
\`\`\`bash
npm run dev
\`\`\`
Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

---

## 🗺️ Future Scope & Enterprise Roadmap

While our current Next.js/Gemini MVP proves the mathematical and heuristic models, TrueClaim is designed to evolve into a distributed, cloud-native platform:
* **Microservices Architecture:** Transitioning to event-driven Kubernetes clusters to automatically scale during high-volume claim traffic.
* **Distributed Semantic Data:** Migrating to PostgreSQL for secure financial tracking, coupled with Vector Databases for high-speed semantic searches.
* **Hybrid OCR Pipeline:** Offloading bulk PDF processing to Enterprise Cloud Vision APIs while maintaining Tesseract.js for real-time dashboard rendering.

---

## 👥 Contributors
* **Arnav Bansal** (Delhi Technological University)
* **Deepank Bansal** (Maharaja Agrasen Institute of Technology)
* **Soham Kapur** (Thapar Institute of Engineering and Technology)
