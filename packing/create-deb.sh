
version_from_npm() {
	node -e "
		const packageInfo = JSON.parse(fs.readFileSync(
			'package.json', { encoding: 'utf8' }
		));
		console.log(packageInfo.version);
	" || return $?
}

src_dir="packing/deb"
temp_dir="deb-bin"
DEBIAN="$temp_dir/DEBIAN"
lib_dir="$temp_dir/usr/lib/3nweb"
conf_yaml="/etc/3nweb/conf.yaml"
dist_dir="dist"

mkdir -p $DEBIAN
# cp -r $src_dir/etc $src_dir/lib $src_dir/usr $temp_dir/
cp -r $src_dir/lib $src_dir/usr $temp_dir/
mkdir -p $lib_dir
cp $dist_dir/spec-3nweb-server $lib_dir/
chmod 755 $lib_dir/*

cd $temp_dir
find . -type f | xargs md5sum > DEBIAN/md5sums
cd ..

cp $src_dir/postinst $DEBIAN/
chmod 755 $DEBIAN/postinst

# echo $conf_yaml > $DEBIAN/conffiles

package_name="3nweb-server"
deb_version=$(version_from_npm)-1
size_kb=$(du -ksc $temp_dir/usr | grep total | cut -f1)

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
" > $DEBIAN/control

echo ""

dpkg --build $temp_dir $dist_dir/${package_name}_${deb_version}.deb

dpkg_res=$?
rm -rf $temp_dir
exit $pkg_res
