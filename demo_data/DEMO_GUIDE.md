# Case Study: Arnav Bansal (Teleportation & Unbundling)

This dataset demonstrates the TrueClaim audit engine's ability to detect multi-modal fraud, timeline impossible travel, and financial leakage.

## Files Included:
- **Arnav.csv**: The billing data file to be uploaded to the dashboard.
- **Arnav1.png**: Clinical notes (ER Visit).
- **Arnav2.png**: Radiology Report (X-Ray).
- **Arnav3.png**: Physiotherapy Session Notes.

## How to Test:
1. Open the [TrueClaim Dashboard](https://true-claim.vercel.app/).
2. Click **Start Audit** on the landing page.
3. Upload `Arnav.csv` into the **Billing Data** section.
4. Upload `Arnav1.png`, `Arnav2.png`, and `Arnav3.png` into the **Clinical Documentation** section.
5. Click **Process Audit**.

## Expected Findings:
1. **Impossible Travel (Teleportation)**: You will see a "Danger" alert in the Timeline. At 10:30 AM, the patient is billed for an X-Ray at PrimeCare Clinic but simultaneously billed for Physiotherapy at Elite Rehab (25km away).
2. **Ghost Service**: CPT 20610 (Major Joint Injection) is billed, but the clinical notes make no mention of an injection procedure.
3. **Unbundling**: CPT 23650 (Shoulder Dislocation Treatment) and CPT 29240 (Strapping) are billed separately. Standard medical coding rules state that strapping is inclusive of the treatment. 
4. **Resilient AI**: Use the **Officer Toolkit** chatbot to ask "Why is this claim flagged?" and observe the AI Fallback system in action.
