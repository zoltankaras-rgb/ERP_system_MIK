window.InternalUsersModule = {
    masterPassword: null,

    init: function() {
        if (!this.masterPassword) {
            this.masterPassword = prompt("Zadajte hlavné administrátorské heslo pre prístup k správe užívateľov:");
            if (!this.masterPassword) {
                document.querySelector('[data-section="section-dashboard"]').click();
                return;
            }
        }
        this.loadUsers();
    },

    loadUsers: function() {
        const self = this; // Tvrdé uloženie kontextu
        fetch('/api/kancelaria/internal_users/list', {
            headers: { 'X-Admin-Password': self.masterPassword }
        })
        .then(res => res.json())
        .then(data => {
            if (data.error) {
                alert(data.error);
                self.masterPassword = null;
                document.querySelector('[data-section="section-dashboard"]').click();
                return;
            }
            self.renderTable(data);
        })
        .catch(err => console.error("Chyba:", err));
    },

    renderTable: function(users) {
        const tbody = document.getElementById('tbody-internal-users');
        tbody.innerHTML = '';
        users.forEach(u => {
            const tr = document.createElement('tr');
            const roleBadge = `<span style="padding:3px 8px; border-radius:12px; font-size:12px; background:#e2e8f0;">${u.role}</span>`;
            const statusBadge = u.is_active 
                ? '<span style="color:green; font-weight:bold;"><i class="fas fa-check-circle"></i> Aktívny</span>' 
                : '<span style="color:red;"><i class="fas fa-ban"></i> Deaktivovaný</span>';

            tr.innerHTML = `
                <td><strong>${u.username}</strong></td>
                <td>${u.full_name || '-'}</td>
                <td>${roleBadge}</td>
                <td>${statusBadge}</td>
                <td style="text-align:right;">
                    <button class="btn btn-secondary btn-sm" onclick='window.InternalUsersModule.editUser(${JSON.stringify(u)})'>
                        <i class="fas fa-edit"></i> Upraviť
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    showForm: function() {
        document.getElementById('user-form-container').style.display = 'block';
        document.getElementById('user-id').value = '';
        document.getElementById('user-username').value = '';
        document.getElementById('user-fullname').value = '';
        document.getElementById('user-password').value = '';
        document.getElementById('user-role').value = 'vyroba';
        document.getElementById('user-is-active').checked = true;
        document.getElementById('user-form-title').innerText = 'Nový používateľ';
        document.getElementById('btn-delete-user').style.display = 'none'; 
    },

    hideForm: function() {
        document.getElementById('user-form-container').style.display = 'none';
    },

    editUser: function(user) {
        this.showForm();
        document.getElementById('user-form-title').innerText = 'Upraviť používateľa: ' + user.username;
        document.getElementById('user-id').value = user.id;
        document.getElementById('user-username').value = user.username;
        document.getElementById('user-fullname').value = user.full_name || '';
        document.getElementById('user-role').value = user.role;
        document.getElementById('user-is-active').checked = (user.is_active === 1);
        document.getElementById('btn-delete-user').style.display = 'block'; 
    },

    // Fyzické zmazanie
    deleteUserFromForm: function() {
        const self = this; // Tvrdé uloženie kontextu
        const userId = document.getElementById('user-id').value;
        const username = document.getElementById('user-username').value;

        if (!userId) return;

        if (!confirm(`Naozaj chcete NATRVALO VYMAZAŤ používateľa "${username}" z databázy? \nTáto akcia sa nedá vrátiť späť.`)) {
            return;
        }

        fetch('/api/kancelaria/internal_users/delete', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'X-Admin-Password': self.masterPassword
            },
            body: JSON.stringify({ id: userId })
        })
        .then(res => res.json())
        .then(result => {
            if(result.success) {
                alert(result.message);
                self.hideForm();
                self.loadUsers();
            } else {
                alert("Chyba: " + result.error);
            }
        })
        .catch(err => console.error("Chyba pri mazaní:", err));
    },

    saveUser: function() {
        const self = this; // Tvrdé uloženie kontextu
        const payload = {
            id: document.getElementById('user-id').value,
            username: document.getElementById('user-username').value,
            full_name: document.getElementById('user-fullname').value,
            password: document.getElementById('user-password').value,
            role: document.getElementById('user-role').value,
            is_active: document.getElementById('user-is-active').checked ? 1 : 0
        };

        fetch('/api/kancelaria/internal_users/save', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'X-Admin-Password': self.masterPassword
            },
            body: JSON.stringify(payload)
        })
        .then(res => res.json())
        .then(result => {
            if(result.success) {
                alert(result.message);
                self.hideForm();
                self.loadUsers();
            } else {
                alert("Chyba: " + result.error);
            }
        })
        .catch(err => console.error("Chyba pri ukladaní:", err));
    }
};

// Naviazanie na kliknutie v ľavom menu Kancelárie
document.addEventListener("DOMContentLoaded", () => {
    const link = document.querySelector('[data-section="section-internal-users"]');
    if(link) {
        link.addEventListener('click', () => {
            window.InternalUsersModule.init();
        });
    }
});