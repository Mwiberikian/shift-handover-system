# Requirements

Source: Chapter 4, Section 4.2 of the project proposal (`KianMwiberi_159377_ShiftHandoverManagementSystem_Proposal_Ch4.docx`). The requirement statements, priorities, sources and verification methods below are copied word for word from Tables 4.1 to 4.4 of that document. Do not edit them here; change the proposal first.

## 4.2.1 Functional Requirements

| ID | Requirement statement | Priority | Source / rationale | Verification method |
|---|---|---|---|---|
| FR-01 | The system shall allow a system administrator to create, modify and deactivate user accounts, each assigned to exactly one department and one role. | High | User scope, Sec. 1.5.1 | Demonstration |
| FR-02 | The system shall authenticate a registered user by staff number or email address and password, and issue a signed session token, before granting access to any role-specific function. | High | Technical scope, Sec. 1.5.1 | Testing |
| FR-03 | The system shall restrict every function and data view to the role and department assigned to the authenticated user, refusing all other requests. | High | Objective iv; O’Brien et al. (2021) | Access-control testing |
| FR-04 | The system shall present outgoing staff with the structured handover template configured for their department and require completion of all mandatory fields before submission is permitted. | High | Standardisation gap, Sec. 2.2.2 | Inspection and testing |
| FR-05 | The system shall allow outgoing staff to record one or more tasks against a handover record, each with a description, a status of open, in-progress or resolved, and a priority. | High | Data scope, Sec. 1.5.1 | Demonstration |
| FR-06 | The system shall allow outgoing staff to record incidents within the same handover record, each with a title, description, severity and time of occurrence. | High | Integration gap, Sec. 2.4 | Demonstration |
| FR-07 | The system shall reject any submission in which mandatory template fields, task entries or shift metadata are incomplete, and shall display the specific outstanding items to the user. | High | Parke and Kanki (2008) | Negative-case testing |
| FR-08 | The system shall automatically carry forward every task still open or in progress at shift closure into the next handover record for the same department, preserving its link to the originating task. | Medium | Information loss, Sec. 2.2.2 | Testing |
| FR-09 | The system shall lock a handover record against editing once it has been submitted, so that any correction is recorded as a new entry rather than an alteration of the original. | High | Audit trail gap, Sec. 2.4 | Inspection and testing |
| FR-10 | The system shall notify the designated incoming staff member and the department supervisor once a handover record has been submitted. | High | Starmer et al. (2014) | Testing |
| FR-11 | The system shall allow incoming staff to view the handover record assigned to their department and shift, including all tasks, incidents and carried-forward items. | High | Objective iv | Demonstration |
| FR-12 | The system shall require the incoming staff member to record a formal acknowledgement confirming receipt and understanding before a handover record can proceed to closure. | High | O’Brien et al. (2021); Parke et al. (2010) | Testing |
| FR-13 | The system shall allow incoming staff to raise a clarification query against a handover record, returning it to the outgoing staff member without discarding the original content. | Medium | Bidirectionality, Sec. 2.2.2 | Demonstration |
| FR-14 | The system shall present supervisors with a department dashboard showing handover status, acknowledgement completion rates and outstanding items for the current and preceding shifts. | High | Objective iv; Sec. 2.3.4 | Demonstration |
| FR-15 | The system shall allow a supervisor to approve a handover or escalate outstanding items, recording the decision, the supervisor identity and any comments against the record. | High | Sec. 3.5.1 | Demonstration |
| FR-16 | The system shall allow authorised users to search the shift log history by date range, department, shift, record status and free-text keyword. | Medium | Technical scope, Sec. 1.5.1 | Testing |
| FR-17 | The system shall write an audit entry for every creation, submission, acknowledgement, review and administrative action, capturing the user, action, entity, timestamp and changed values. | High | Audit trail gap, Sec. 2.4 | Inspection and testing |
| FR-18 | The system shall allow the administrator to define and version the handover template fields applicable to each of the four target departments. | Medium | Departmental scope, Sec. 1.5.1 | Demonstration |
| FR-19 | The system shall alert the department supervisor when a submitted handover record remains unacknowledged beyond the configured interval after the start of the incoming shift. | Medium | Missed-task control, Sec. 2.4 | Testing |
| FR-20 | The system shall allow supervisors and administrators to export a handover record together with its audit trail as a portable document for management or regulatory review. | Low | Auditability, Sec. 2.4 | Demonstration |

_Table 4.1: Functional requirements catalogue for the Shift Handover Management System._

## 4.2.2 Non-Functional Requirements

| ID | Requirement statement | Priority | Source / rationale | Verification method |
|---|---|---|---|---|
| NFR-01 | Under a load of 60 concurrent authenticated users, at least 95% of primary interface views shall render within 2 seconds. | High | Evaluation metrics, Sec. 3.3.4 | Load measurement |
| NFR-02 | At least 95% of handover submissions, including database persistence, shall complete within 3 seconds under standard broadband conditions. | High | Evaluation metrics, Sec. 3.3.4 | Load measurement |
| NFR-03 | Notification of a submitted handover shall reach the recipient’s in-application inbox within 5 seconds of submission. | High | Evaluation metrics, Sec. 3.3.4 | Timed testing |
| NFR-04 | The system shall sustain at least 60 concurrent sessions, corresponding to four departments at approximately fifteen active users each, without degrading NFR-01 by more than 20%. | Medium | Departmental and user scope, Sec. 1.5.1 | Load measurement |
| NFR-05 | User passwords shall be stored only as salted hashes generated with a work factor of at least 12, and shall never be written to logs or responses. | High | Application security practice | Inspection and testing |
| NFR-06 | A session token shall expire after no more than 30 minutes of inactivity, after which re-authentication shall be required. | High | Application security practice | Testing |
| NFR-07 | Every attempt to access a function or record outside the authenticated user’s role or department shall be refused, across 100% of tested boundary scenarios. | High | Evaluation metrics, Sec. 3.3.4 | Access-control test matrix |
| NFR-08 | All client-server communication shall take place over TLS version 1.2 or higher. | High | Application security practice | Inspection |
| NFR-09 | No interface or API path shall permit the alteration or deletion of a submitted handover record or of any audit entry. | High | Audit trail gap, Sec. 2.4 | Inspection and penetration testing |
| NFR-10 | All writes belonging to a single handover submission shall be committed within one ACID transaction, so that a failure part-way through leaves no partial record. | High | PostgreSQL justification, Sec. 1.4 | Fault-injection testing |
| NFR-11 | The system shall be restorable from the most recent backup within 30 minutes, with no loss of records committed more than 24 hours earlier. | Medium | Auditability and continuity | Recovery test |
| NFR-12 | A user familiar with their department’s handover content shall complete a standard handover record within 10 minutes, and at least 80% of scenario walkthrough tasks shall be completed without assistance. | Medium | Scenario walkthroughs, Sec. 3.3.3 | Usability walkthrough |
| NFR-13 | The prototype shall achieve a System Usability Scale score of at least 68 at final evaluation. | Medium | Sauro and Lewis (2016) benchmark | SUS questionnaire |
| NFR-14 | All interface text shall maintain a contrast ratio of at least 4.5:1 against its background and all functions shall be operable by keyboard alone. | Medium | WCAG 2.1 AA | Automated and manual inspection |
| NFR-15 | The interface shall render and operate correctly on the current and preceding major versions of Chrome, Edge, Firefox and Safari, at viewport widths from 320 to 1920 pixels. | Medium | Web and mobile scope, Sec. 1.5.1 | Cross-browser testing |
| NFR-16 | Presentation, application and data layers shall remain separately deployable, and automated unit tests shall cover at least 70% of backend service statements. | Medium | Modularity, Sec. 3.2 | Coverage report |
| NFR-17 | Every functional requirement shall be traceable to at least one documented test case in the system test report. | High | Objective v | Traceability review |
| NFR-18 | The system shall run on any host providing Node.js 18 or later and PostgreSQL 15 or later, with all environment-specific values supplied as configuration rather than code. | Low | Open-source stack, Sec. 1.4 | Deployment test |
| NFR-19 | The system shall not transition a handover record to a closed state without a recorded human acknowledgement. | High | O’Brien et al. (2021) | Testing |

_Table 4.2: Non-functional requirements and their verification methods._

## 4.2.3 Data Requirements

| ID | Requirement statement | Priority | Source / rationale | Verification method |
|---|---|---|---|---|
| DR-01 | The system shall capture, as its primary inputs, structured handover records comprising task entries, incident entries, pending items and shift summary notes, owned by Kenya Airways as the operating organisation. | High | Data scope, Sec. 1.5.1 | Inspection |
| DR-02 | All temporal attributes shall be stored with time zone information in Coordinated Universal Time and presented to users in East Africa Time, using ISO 8601 formatting. | High | Traceability of shift boundaries | Inspection and testing |
| DR-03 | Task status, task priority, incident severity, record status and user role shall be constrained to database-enforced enumerated values rather than free text. | High | Standardisation gap, Sec. 2.2.2 | Schema inspection |
| DR-04 | Every task entry shall carry a description of between 10 and 1,000 characters, and every incident entry shall carry a severity and a time of occurrence. | Medium | Completeness rule, FR-07 | Validation testing |
| DR-05 | At most one handover record shall exist in an open state for any combination of department and shift, enforced by a database uniqueness constraint. | High | Duplicate prevention | Constraint testing |
| DR-06 | Referential integrity between users, records, tasks, incidents, acknowledgements and reviews shall be enforced by foreign keys with restricted deletion. | High | PostgreSQL justification, Sec. 1.4 | Schema inspection |
| DR-07 | Every record shall retain the identity of the creating user, the acknowledging user and the reviewing supervisor, and the audit relation shall retain the previous and new values of every change. | High | Accountability framework, Sec. 2.6 | Inspection and testing |
| DR-08 | Handover records and audit entries shall be retained online for 24 months and thereafter archived; no interface shall provide hard deletion of either. | Medium | Auditability; subject to KQ policy confirmation | Inspection |
| DR-09 | A full logical backup shall be taken daily and write-ahead logs archived continuously, with restoration tested against NFR-11. | Medium | Continuity of the audit record | Recovery test |
| DR-10 | The system shall store only operational staff data, namely name, staff number, work email address, department and role; no passenger data and no personal data beyond that required shall be held. | High | Data minimisation | Inspection |
| DR-11 | The prototype shall be populated with representative synthetic data modelled on publicly documented departmental structures, and every evaluation result shall identify the data as synthetic. | High | Access limitation, Sec. 1.5.2 | Inspection of evaluation report |
| DR-12 | All input validation shall be applied at the API layer before persistence, and every rejected submission shall be logged with the reason for rejection. | High | Integrity of the record set | Testing |

_Table 4.3: Data requirements for the Shift Handover Management System._

## 4.2.4 Interface and Integration Requirements

| ID | Requirement statement | Priority | Source / rationale | Verification method |
|---|---|---|---|---|
| IR-01 | The user interface shall be delivered as a responsive single-page application with layout breakpoints at 320, 768 and 1280 pixels and touch targets of at least 44 pixels. | High | Web and mobile scope, Sec. 1.5.1 | Cross-device inspection |
| IR-02 | The client and server shall communicate over HTTPS using a resource-oriented REST interface exchanging JSON, returning standard HTTP status codes for success, validation failure, authorisation failure and server error. | High | Node.js and Express justification, Sec. 1.4 | API contract testing |
| IR-03 | Authenticated requests shall carry a signed JSON Web Token in the Authorization header, containing the user identifier, role, department and expiry claims. | High | Stateless authentication, Sec. 3.7.3 | Testing |
| IR-04 | The server shall access PostgreSQL through a pooled node-postgres connection using parameterised queries exclusively, with no query constructed by string concatenation. | High | Sec. 3.7.2; injection prevention | Code inspection and testing |
| IR-05 | Notifications shall be delivered through an in-application channel and an SMTP electronic mail gateway, both accessed through a single service interface so that a channel can be substituted without altering calling code. | Medium | FR-10; maintainability, NFR-16 | Demonstration |
| IR-06 | An outbound electronic mail dispatch that fails shall be retried up to three times with exponential backoff, and the final outcome recorded against the notification record. | Medium | Reliability of alerting | Fault-injection testing |
| IR-07 | Where the electronic mail gateway is unavailable, the in-application notification shall still be delivered, the handover record shall remain in the submitted state, and the undelivered alert shall be flagged on the supervisor dashboard. | High | Degraded-mode behaviour | Fault-injection testing |
| IR-08 | The API shall be published as a versioned contract under a stable path prefix, so that future integration with Kenya Airways’ enterprise systems can be added without redesign of the internal model. | Medium | Exclusions, Sec. 1.5.1 | Design review |
| IR-09 | Authentication shall be implemented as a replaceable service against a local credential store, structured so that a corporate directory or single sign-on provider could later be substituted behind the same interface. | Low | Prototype boundary, Sec. 1.5.3 | Design review |

_Table 4.4: Interface and integration requirements._

## Draft requirements FR-21..FR-25

_Not present. The proposal defines FR-01..FR-20 only, and no draft text for FR-21..FR-25 was found in the repository or alongside the proposal._
