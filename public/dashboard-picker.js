// Shared channel/role picker. The hidden select is the source of truth.
const dashboardPickerInstances = new Set();

function createDashboardPicker({ root, storage, onChange }) {
  const control = root.querySelector('.picker-control');
  const tags = root.querySelector('.picker-tags');
  const placeholder = root.querySelector('.picker-placeholder');
  const menu = root.querySelector('.picker-menu');
  root.classList.add('dashboard-multiselect');

  function close() {
    root.classList.remove('open');
    control.setAttribute('aria-expanded', 'false');
  }

  function sync() {
    const selected = [...storage.selectedOptions];
    placeholder.classList.toggle('hidden', selected.length > 0);
    tags.replaceChildren(...selected.map(option => {
      const tag = document.createElement('span');
      tag.className = 'picker-tag';
      tag.textContent = option.textContent;
      return tag;
    }));
    for (const button of menu.querySelectorAll('button[data-value]')) {
      const option = [...storage.options].find(option => option.value === button.dataset.value);
      button.classList.toggle('selected', !!option?.selected);
      button.setAttribute('aria-pressed', String(!!option?.selected));
    }
  }

  function render() {
    close();
    menu.replaceChildren(...[...storage.options].map(option => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.value = option.value;
      button.textContent = option.textContent;
      button.disabled = option.disabled;
      button.onclick = () => {
        option.selected = !option.selected;
        // Update in place so selection keeps keyboard focus and menu scroll.
        sync();
        onChange();
      };
      return button;
    }));
    if (!storage.options.length) {
      const empty = document.createElement('div');
      empty.className = 'empty compact';
      empty.textContent = 'No available options.';
      menu.append(empty);
    }
    sync();
  }

  control.onclick = () => {
    const open = !root.classList.contains('open');
    for (const picker of dashboardPickerInstances) picker.close();
    root.classList.toggle('open', open);
    control.setAttribute('aria-expanded', String(open));
  };
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      close();
      control.focus();
      event.stopPropagation();
    }
  });
  const picker = { root, render, close };
  dashboardPickerInstances.add(picker);
  return picker;
}

document.addEventListener('click', event => {
  for (const picker of dashboardPickerInstances) {
    if (!picker.root.contains(event.target)) picker.close();
  }
});
