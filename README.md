Here is the detailed Module Architecture Map formatted for your `README.md` file.

```markdown
# CMMS Module Architecture Map

This document outlines the file structure, state management, and specific function responsibilities for the CMMS application. Provide this map to any AI assistant to ensure context-aware code modifications.

## Directory Structure
```text
/
├── index.html
├── style.css
└── js/
    ├── app.js
    ├── store.js
    ├── auth.js
    ├── assets.js
    ├── schedules.js
    └── workOrders.js

```

## Core Architecture & State

### `index.html`
The single-page application skeleton. Contains all static UI elements, forms, and hidden modals (New Work Order, Close Work Order, Asset History). Relies on inline event handlers (e.g., `onclick="window.signIn()"`) due to ES6 module scoping.

### `style.css`

Manages the global Zinc dark-mode color palette (`:root` variables), layout scaffolding, modal overlays, CSS animations (spinners, toasts), and custom component styling (searchable dropdowns).

### `js/store.js`

The central state management and configuration hub.

* **`sb`**: Initializes the Supabase client.
* **`state`**: Holds global objects (`currentUser`, `currentRole`, `assetsCache`, `schedulesCache`, `activeWorkOrders`, `woToClose`) to prevent data desync between modules.
* **`toast(msg, kind)`**: Triggers temporary UI notification popups.
* **`setButtonLoading(btnId, isLoading, originalText)`**: Disables buttons and shows a spinner during network requests to prevent duplicate submissions.
* **`getLoaderHtml(text)`**: Returns standardized HTML for loading states.
* **`formatDate(iso)`**: Converts ISO timestamps into a readable short format.
* **`escapeHtml(str)`**: Sanitizes string inputs to prevent XSS attacks.

### `js/app.js`

The primary orchestrator. Imports all module functions and binds them to the global `window` object so HTML `onclick` attributes function properly.

* **`switchTab(tab)`**: Hides/shows main application sections (Work Orders, Assets, PMs) and reloads relevant data.
* **Event Listeners**: Initializes DOM click and input listeners for the custom searchable asset dropdown to handle clicking outside the menu.

## Feature Modules

### `js/auth.js`

Handles user sessions and Role-Based Access Control (RBAC).

* **`signIn()`**: Authenticates the user via Supabase and handles UI error states.
* **`signOut()`**: Clears the session and returns the user to the login screen.
* **`onSignedIn(user)`**: Fetches the user's role from the `user_roles` table, toggles the main app UI, and selectively hides "Create" buttons based on Admin/Technician/Viewer status.

### `js/assets.js`

Manages equipment records and historical context.

* **`createAsset()` / `openNewAssetForm()` / `closeNewAssetForm()**`: Handles the UI and database insertion for new equipment.
* **`loadAssets(render)`**: Fetches the asset list to update the global cache and optionally renders the DOM cards.
*   **`openAssetHistoryModal(assetId, assetName)` / `closeAssetHistoryModal()`**: Triggers the global asset history modal from anywhere in the app, fetching and displaying a timeline of up to 20 recently closed Work Orders for the selected asset.
* **`renderAssetDropdown(filter)`**: Updates the DOM of the custom select menu based on search input.
* **`selectAsset(id, name)`**: Handles the user clicking an item in the custom dropdown and populates the hidden input values.

### `js/workOrders.js`
Manages the core maintenance ticketing workflow and closure constraints.
*   **`createWorkOrder()` / `openNewWoForm()` / `closeNewWoForm()`**: Handles form submission, linking PM schedules if applicable, and inserting initial checklist records.
*   **`loadWorkOrders()` / `renderWorkOrders()`**: Fetches tickets based on the active filter (Open/Closed) and builds the DOM cards. Asset names on the cards act as interactive links that trigger `openAssetHistoryModal()`.
*   **`filterWorkOrders()`**: Client-side search function that hides/shows DOM cards based on text input.
*   **`triggerUpdateFlow(id)` / `closeUpdateModal()`**: Opens the unified update modal for a specific ticket, loading its original description.
*   **`reviewUpdateWo()` / `backToEditWo()`**: Transitions the modal to the confirmation step. Dynamically calculates the new ticket status (`closed`, `waiting_parts`, `in_progress`) based on checkbox states and text input. Validates that breakdown closures include resolution notes.
*   **`confirmSaveWo()`**: Appends the new timestamped note and status change to the ticket's description and finalizes the write to Supabase.
*   **`loadChecklistForWo(woId)` / `toggleChecklistItem(resultId, checkboxEl)`**: Fetches and toggles the completion status of individual PM tasks attached to a specific ticket.

### `js/schedules.js`

Manages recurring Preventative Maintenance (PM) templates.

* **`createSchedule()` / `openNewScheduleForm()` / `closeNewScheduleForm()**`: Handles UI and database insertion for new recurring PM rules.
* **`loadSchedules()`**: Fetches and renders all active PM schedules.
* **`addChecklistItem(scheduleId)`**: Appends a new required task to an existing PM schedule.
* **`loadChecklistItems(scheduleId)`**: Renders the task list on the schedule card.
* **`populateScheduleSelect(id)`**: Dynamically populates the "Schedule" `<select>` in the New Work Order form based on the currently chosen Asset.

```

```
