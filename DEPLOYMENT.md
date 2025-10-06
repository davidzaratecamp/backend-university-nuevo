# Guía de Despliegue en Ubuntu Server

## Requisitos Previos

- Ubuntu 24.04 LTS
- Acceso SSH al servidor
- Permisos sudo

## 1. Instalar Dependencias del Sistema

```bash
# Actualizar sistema
sudo apt update && sudo apt upgrade -y

# Instalar Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verificar instalación
node --version
npm --version

# Instalar MySQL
sudo apt install -y mysql-server

# Instalar PM2 (gestor de procesos para Node.js)
sudo npm install -g pm2

# Instalar Nginx (servidor web)
sudo apt install -y nginx

# Instalar Git
sudo apt install -y git
```

## 2. Configurar MySQL

```bash
# Iniciar MySQL
sudo systemctl start mysql
sudo systemctl enable mysql

# Configurar MySQL (seguir el asistente)
sudo mysql_secure_installation

# Crear base de datos
sudo mysql -u root -p
```

En MySQL ejecutar:

```sql
CREATE DATABASE new_asisteuniversity;
CREATE USER 'asiste_user'@'localhost' IDENTIFIED BY 'TU_CONTRASEÑA_SEGURA';
GRANT ALL PRIVILEGES ON new_asisteuniversity.* TO 'asiste_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

## 3. Clonar Repositorio Backend

```bash
# Ir al directorio home
cd ~

# Clonar repositorio
git clone https://github.com/davidzaratecamp/backend-university-nuevo.git
cd backend-university-nuevo

# Instalar dependencias
npm install
```

## 4. Configurar Variables de Entorno

```bash
# Copiar archivo de ejemplo
cp .env.example .env

# Editar archivo .env
nano .env
```

Configurar con los valores de producción:

```env
PORT=5001
DB_HOST=localhost
DB_USER=asiste_user
DB_PASSWORD=TU_CONTRASEÑA_SEGURA
DB_NAME=new_asisteuniversity
JWT_SECRET=genera_un_secret_aleatorio_muy_largo_y_seguro_aqui
JWT_EXPIRES_IN=7d
```

## 5. Inicializar Base de Datos

```bash
# Crear tablas
node init-db.js

# Crear usuario administrador
node create-admin.js
```

## 6. Configurar PM2 para Backend

```bash
# Crear archivo ecosystem para PM2
pm2 start server.js --name "asiste-backend"

# Guardar configuración de PM2
pm2 save

# Configurar PM2 para iniciar al arrancar el sistema
pm2 startup
```

## 7. Configurar Nginx como Reverse Proxy

```bash
# Crear archivo de configuración
sudo nano /etc/nginx/sites-available/asiste-university
```

Contenido del archivo:

```nginx
server {
    listen 80;
    server_name TU_IP_O_DOMINIO;

    # Backend API
    location /api {
        proxy_pass http://localhost:5001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Socket.IO
    location /socket.io {
        proxy_pass http://localhost:5001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Archivos estáticos (uploads)
    location /uploads {
        proxy_pass http://localhost:5001;
    }

    # Frontend
    location / {
        root /home/asiste/frontend-university-nuevo/dist;
        try_files $uri $uri/ /index.html;
    }
}
```

```bash
# Habilitar sitio
sudo ln -s /etc/nginx/sites-available/asiste-university /etc/nginx/sites-enabled/

# Eliminar sitio por defecto
sudo rm /etc/nginx/sites-enabled/default

# Verificar configuración
sudo nginx -t

# Reiniciar Nginx
sudo systemctl restart nginx
```

## 8. Configurar Firewall

```bash
# Habilitar firewall
sudo ufw enable

# Permitir SSH
sudo ufw allow ssh

# Permitir HTTP y HTTPS
sudo ufw allow 'Nginx Full'

# Verificar estado
sudo ufw status
```

## 9. Verificar Backend

```bash
# Ver logs de PM2
pm2 logs asiste-backend

# Ver estado
pm2 status

# Probar API
curl http://localhost:5001/api/auth/login
```

## 10. Comandos Útiles

```bash
# Actualizar código
cd ~/backend-university-nuevo
git pull
npm install
pm2 restart asiste-backend

# Ver logs
pm2 logs asiste-backend
pm2 logs asiste-backend --lines 100

# Monitorear recursos
pm2 monit

# Reiniciar servicio
pm2 restart asiste-backend

# Detener servicio
pm2 stop asiste-backend

# Ver estado de Nginx
sudo systemctl status nginx

# Reiniciar Nginx
sudo systemctl restart nginx

# Ver logs de Nginx
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/access.log
```

## 11. Configuración de Seguridad Adicional

```bash
# Instalar fail2ban (protección contra ataques de fuerza bruta)
sudo apt install -y fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban

# Configurar actualizaciones automáticas
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

## Notas Importantes

1. Cambia todas las contraseñas por valores seguros
2. Considera usar HTTPS con Let's Encrypt (Certbot)
3. Configura backups regulares de la base de datos
4. Monitorea los logs regularmente
5. Mantén el sistema actualizado

## IP del Servidor

```
IP: 10.255.255.167
Usuario: asiste
```
