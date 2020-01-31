
mkdir -p deb-bin/DEBIAN deb-bin/usr/share/3nweb-server

cp -r build node_modules package.json package-lock.json LICENSE deb-bin/usr/share/3nweb-server/

cp -r packing/deb/usr/bin deb-bin/usr/
chmod 755 deb-bin/usr/bin/*

cp -r packing/deb/etc deb-bin/

cp -r packing/deb/usr/share/doc deb-bin/usr/share/

cd deb-bin
find . -type f | xargs md5sum > DEBIAN/md5sums
cd ..

cp packing/deb/postinst deb-bin/DEBIAN/
chmod 755 deb-bin/DEBIAN/postinst

echo "/etc/3nweb/services.json" > deb-bin/DEBIAN/conffiles

package_name="3nweb-server"
npm_version=$(node packing/deb/package-version.js)
deb_version=${npm_version}-1
size_kb=$(du -ksc deb-bin/usr | grep total | cut -f1)

echo "
Package: $package_name
Version: $deb_version
Architecture: all
Section: web
Maintainer: 3NSoft Inc <hq@3nsoft.com>
Installed-Size: $size_kb
Homepage: https://3nweb.com
Description: Provides messaging, storage and indentity services for 3NWeb
 $package_name provides all 3NWeb services: ASMail messaging, 3NStorage and
 MailerId identity.
" > deb-bin/DEBIAN/control

dpkg --build deb-bin ${package_name}_${deb_version}.deb
