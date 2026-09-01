import { sb } from './store.js';
import { signIn, signOut, onSignedIn } from './auth.js';
import { openNewAssetForm, closeNewAssetForm, createAsset, loadAssets, openAssetHistoryModal, closeAssetHistoryModal, renderAssetDropdown, selectAsset, goToSchedule, toggleScheduleItems } from './assets.js';
import { openNewScheduleForm, closeNewScheduleForm, createSchedule, loadSchedules, addChecklistItem, toggleNewItemUnit } from './schedules.js';
import { openNewWoForm, closeNewWoForm, createWorkOrder, loadWorkOrders, filterWorkOrders, triggerUpdateFlow, closeUpdateModal, reviewUpdateWo, backToEditWo, confirmSaveWo, toggleChecklistItem, saveReadingValue } from './workOrders.js';

// Bind to Window so HTML onclicks work
window.signIn = signIn;
window.signOut = signOut;

window.openNewAssetForm = openNewAssetForm;
window.closeNewAssetForm = closeNewAssetForm;
window.createAsset = createAsset;
window.openAssetHistoryModal = openAssetHistoryModal;
window.closeAssetHistoryModal = closeAssetHistoryModal;
window.selectAsset = selectAsset;
window.goToSchedule = goToSchedule;

window.openNewScheduleForm = openNewScheduleForm;
window.closeNewScheduleForm = closeNewScheduleForm;
window.createSchedule = createSchedule;
window.addChecklistItem = addChecklistItem;
window.toggleNewItemUnit = toggleNewItemUnit;

window.openNewWoForm = openNewWoForm;
window.closeNewWoForm = closeNewWoForm;
window.createWorkOrder = createWorkOrder;
window.loadWorkOrders = loadWorkOrders;
window.filterWorkOrders = filterWorkOrders;
window.triggerUpdateFlow = triggerUpdateFlow;
window.closeUpdateModal = closeUpdateModal;
window.reviewUpdateWo = reviewUpdateWo;
window.backToEditWo = backToEditWo;
window.confirmSaveWo = confirmSaveWo;
window.toggleChecklistItem = toggleChecklistItem;
window.saveReadingValue = saveReadingValue;

// Tab Logic
window.switchTab = function(tab) {
  ['wo','assets','schedules'].forEach(t => document.getElementById('tab-' + t).classList.toggle('hidden', t !== tab));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'assets') loadAssets(true);
  if (tab === 'schedules') loadSchedules();
}

// Global Event Listeners for the Searchable Dropdown
const searchInput = document.getElementById('wo-asset-search');
const dropdownList = document.getElementById('wo-asset-dropdown');
const hiddenAssetValue = document.getElementById('wo-asset-value');

if (searchInput) {
  searchInput.addEventListener('focus', () => {
    renderAssetDropdown(searchInput.value);
    dropdownList.classList.remove('hidden');
  });

  searchInput.addEventListener('input', (e) => {
    hiddenAssetValue.value = ''; 
    renderAssetDropdown(e.target.value);
    dropdownList.classList.remove('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-select-wrapper')) {
      dropdownList.classList.add('hidden');
    }
  });
}

// Check session on load
sb.auth.getSession().then(({ data }) => { if (data.session) onSignedIn(data.session.user); });
