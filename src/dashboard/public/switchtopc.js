
var isChecked = false;
// 检测移动端或小屏幕并显示提示
function checkMobile() {
	// 同意一次不再提示
	if(!isChecked){
		// 设备类型检测
		const isMobile = /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
		const isMobile_pointer = window.matchMedia("(pointer:coarse)").matches;
		const isiPad = /iPad/i.test(navigator.userAgent);
		
		// 屏幕宽度检测
		if (window.innerWidth < 400) {
			var isSmallScreen = true;
		}
		
		// 显示条件：手机设备或小屏幕，且非平板
		if ((isMobile || isSmallScreen || isMobile_pointer) && !isiPad) {
		const alert = document.getElementById('pc-mode-alert');
		alert.style.display = 'flex';
		
		// 继续使用按钮
		document.getElementById('continue-mobile').addEventListener('click', () => {
			alert.style.display = 'none';
		});
		}
		isChecked = true;
	}
  }
  // 页面加载和窗口大小变化时都执行检查
  document.addEventListener('DOMContentLoaded', checkMobile);
  window.addEventListener('resize', checkMobile);

