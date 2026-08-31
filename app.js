import { applyDocumentEdit, applyPineconeEdits, canStartWarehouseOrganization, createEmptyWarehouseRecord, deriveShelfSections, getWarehouseColor, getWarehouseRecords, hydrateWarehouseRecord, isWarehouseReadOnly, normalizeWarehouseState, persistWarehouseRecord, removeWarehouseRecord, reorderWarehouseRecords, useOnlyExampleWarehouses } from "./warehouse-management.js";
import { EXAMPLE_COLLECTION_VERSION, exampleWarehouses } from "./example-warehouses.js";
import { organizeWarehouseLocally } from "./organizer.js";

const STORAGE_KEY = "squirrel-warehouse-mvp";
const USE_API_ORGANIZER = false;
const TOUCH_DRAG_HOLD_MS = 300;
const TOUCH_DRAG_MOVE_THRESHOLD = 8;
const WAREHOUSE_AUTO_SCROLL_EDGE = 56;
const WAREHOUSE_AUTO_SCROLL_SPEED = 10;

const asset = (name, className, alt = "") =>
  `<img class="${className}" src="assets/illustrations/${name}" alt="${alt}" ${alt ? "" : 'aria-hidden="true"'}>`;

const icons = {
  squirrel: (className) => asset("squirrel-crayon.png", className),
  logo: (className) => asset("squirrel-wencang-logo-ip.png", className, "松鼠文仓 logo"),
  pinecone: (className) => asset("pinecone-icon.png", className),
  leaf: (className) => asset("leaf-crayon.png", className),
  book: (className) => asset("book-crayon.png", className),
  star: (className) => asset("star-crayon.png", className),
  search: (className) => asset("search-crayon.png", className),
  user: (className) => asset("user-crayon.png", className),
  plus: (className) => asset("plus-crayon.png", className),
  more: (className) => asset("more-crayon.png", className),
  grass: (className) => asset("grass-crayon.png", className),
};

const nowText = () => "今天 " + new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) + " 更新";
const uid = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

const makeWechatProductWarehouse = () => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob("eyJpZCI6IndlY2hhdF9wcm9kdWN0X3BoaWxvc29waHkiLCJuYW1lIjoi44CK5b6u5L+h6IOM5ZCO55qE5Lqn5ZOB6KeC44CLIiwidXBkYXRlZEF0Ijoi5LuK5aSpIDEyOjAwIOabtOaWsCIsInRlbXBMaW1pdCI6NSwicGluZWNvbmVzIjpbeyJpZCI6IndlY2hhdF9wMDFfMDEiLCJjb250ZW50Ijoi5Lqn5ZOB5bqU5YOP5LiA5Liq57O757uf77yM6ICM5LiN5piv5LiA5Liq5Yqf6IO95riF5Y2V44CCIiwic3RhdHVzIjoic2hlbHZlZCIsInNoZWxmSWQiOiJ3ZWNoYXRfMDEiLCJ0YWdzIjpbIumHjeeCuSJdLCJpc0ZlYXR1cmVkIjp0cnVlLCJjcmVhdGVkQXQiOiLku4rlpKkgMTI6MDAifSx7ImlkIjoid2VjaGF0X3AwMV8wMiIsImNvbnRlbnQiOiLkuqflk4HopoHmnInoh6rlt7HnmoQgRE5B77yM5Lmf5bCx5piv5Lu35YC86KeC5ZKM6K6k55+l44CCIiwic3RhdHVzIjoic2hlbHZlZCIsInNoZWxmSWQiOiJ3ZWNoYXRfMDEiLCJ0YWdzIjpbIuaRmOW9lSJdLCJpc0ZlYXR1cmVkIjpmYWxzZSwiY3JlYXRlZEF0Ijoi5LuK5aSpIDEyOjAwIn0seyJpZCI6IndlY2hhdF9wMDFfMDMiLCJjb250ZW50Ijoi6Z2i5ZCR5pyq5p2l5ZKM5Zy65pmv6K6+6K6h77yM6ICM5LiN5piv5Y+q5ZON5bqU5b2T5YmN6ZyA5rGC44CCIiwic3RhdHVzIjoic2hlbHZlZCIsInNoZWxmSWQiOiJ3ZWNoYXRfMDEiLCJ0YWdzIjpbIuaRmOW9lSJdLCJpc0ZlYXR1cmVkIjpmYWxzZSwiY3JlYXRlZEF0Ijoi5LuK5aSpIDEyOjAwIn0seyJpZCI6IndlY2hhdF9wMDFfMDQiLCJjb250ZW50Ijoi5L2T6aqM44CB5rCU6LSo5ZKM5Lq65paH5oSP6K+G5q+U5aCG5Yqf6IO95pu06YeN6KaB44CCIiwic3RhdHVzIjoic2hlbHZlZCIsInNoZWxmSWQiOiJ3ZWNoYXRfMDEiLCJ0YWdzIjpbIuaRmOW9lSJdLCJpc0ZlYXR1cmVkIjpmYWxzZSwiY3JlYXRlZEF0Ijoi5LuK5aSpIDEyOjAwIn0seyJpZCI6IndlY2hhdF9wMDFfMDUiLCJjb250ZW50Ijoi5Lqn5ZOB57uP55CG6KaB55CG6Kej5Lq644CB5oul5oqx5LiN56Gu5a6a5oCn77yM5bm25oqK5Lqn5ZOB5b2T5L2c5ZOB6ZuV5Yi744CCIiwic3RhdHVzIjoic2hlbHZlZCIsInNoZWxmSWQiOiJ3ZWNoYXRfMDEiLCJ0YWdzIjpbIuaRmOW9lSJdLCJpc0ZlYXR1cmVkIjpmYWxzZSwiY3JlYXRlZEF0Ijoi5LuK5aSpIDEyOjAwIn0seyJpZCI6IndlY2hhdF9wMDJfMDEiLCJjb250ZW50Ijoi5Lqn5ZOB57uP55CG5LiN5Y+q5piv6K6+6K6h5Yqf6IO955qE5Lq677yM5pu05YOP5piv5Zyo5Yib6YCg5LiA5Liq5Y+v5Lul6Ieq6KGM6L+Q6L2s55qE57O757uf44CC5aW955qE5Lqn5ZOB5py65Yi26IO96K6p55So5oi36Ieq5bex5Y+R55Sf5pWF5LqL44CB6Ieq5bex5Yib6YCg5YaF5a6544CB6Ieq5bex5b2i5oiQ5L2/55So5pa55byP44CCIiwic3RhdHVzIjoic2hlbHZlZCIsInNoZWxmSWQiOiJ3ZWNoYXRfMDIiLCJ0YWdzIjpbIumHjeeCuSJdLCJpc0ZlYXR1cmVkIjp0cnVlLCJjcmVhdGVkQXQiOiLku4rlpKkgMTI6MDAifSx7ImlkIjoid2VjaGF0X3AwM18wMSIsImNvbnRlbnQiOiLmlbTkvZPlkozosJDvvIzogIzkuI3mmK/nsr7npZ7liIboo4IiLCJzdGF0dXMiOiJzaGVsdmVkIiwic2hlbGZJZCI6IndlY2hhdF8wMyIsInRhZ3MiOlsi6YeN54K5Il0sImlzRmVhdHVyZWQiOnRydWUsImNyZWF0ZWRBdCI6IuS7iuWkqSAxMjowMCJ9LHsiaWQiOiJ3ZWNoYXRfcDAzXzAyIiwiY29udGVudCI6Iue7k+aehOa4heaZsO+8jOWKn+iDveS5i+mXtOacieacuuiBlOezuyIsInN0YXR1cyI6InNoZWx2ZWQiLCJzaGVsZklkIjoid2VjaGF0XzAzIiwidGFncyI6WyLmkZjlvZUiXSwiaXNGZWF0dXJlZCI6ZmFsc2UsImNyZWF0ZWRBdCI6IuS7iuWkqSAxMjowMCJ9LHsiaWQiOiJ3ZWNoYXRfcDAzXzAzIiwiY29udGVudCI6IuWKn+iDveacieWKm+mHj++8jOWDj+S6uueahOiCjOiCiSIsInN0YXR1cyI6InNoZWx2ZWQiLCJzaGVsZklkIjoid2VjaGF0XzAzIiwidGFncyI6WyLmkZjlvZUiXSwiaXNGZWF0dXJlZCI6ZmFsc2UsImNyZWF0ZWRBdCI6IuS7iuWkqSAxMjowMCJ9LHsiaWQiOiJ3ZWNoYXRfcDAzXzA0IiwiY29udGVudCI6IuS6pOS6kueQhuaAp+OAgemAu+i+kea4healmuOAgeWPjeW6lOaVj+aNtyIsInN0YXR1cyI6InNoZWx2ZWQiLCJzaGVsZklkIjoid2VjaGF0XzAzIiwidGFncyI6WyLmkZjlvZUiXSwiaXNGZWF0dXJlZCI6ZmFsc2UsImNyZWF0ZWRBdCI6IuS7iuWkqSAxMjowMCJ9LHsiaWQiOiJ3ZWNoYXRfcDAzXzA1IiwiY29udGVudCI6IuaWh+ahiOW+l+S9k++8jOWDj+S4gOS4quS8muWlveWlveivtOivneeahOS6uiIsInN0YXR1cyI6InNoZWx2ZWQiLCJzaGVsZklkIjoid2VjaGF0XzAzIiwidGFncyI6WyLmkZjlvZUiXSwiaXNGZWF0dXJlZCI6ZmFsc2UsImNyZWF0ZWRBdCI6IuS7iuWkqSAxMjowMCJ9LHsiaWQiOiJ3ZWNoYXRfcDAzXzA2IiwiY29udGVudCI6IuiDjOWQjuacieeos+WumuS7t+WAvOingu+8jOiAjOS4jeaYr+maj+WKn+iDveaRh+aRhiIsInN0YXR1cyI6InNoZWx2ZWQiLCJzaGVsZklkIjoid2VjaGF0XzAzIiwidGFncyI6WyLmkZjlvZUiXSwiaXNGZWF0dXJlZCI6ZmFsc2UsImNyZWF0ZWRBdCI6IuS7iuWkqSAxMjowMCJ9LHsiaWQiOiJ3ZWNoYXRfcDA0XzAxIiwiY29udGVudCI6IuWBmuS6p+WTgeS4jeiDveWPquS+nei1luW3suacieaVsOaNruWSjOe7j+mqjOOAgumdouWvueacquadpeaXtu+8jOmcgOimgeaaguaXtuW/mOiusOaXp+S4lueVjOeahOaDr+aAp++8jOmHjeaWsOa0nuWvn+i2i+WKv++8jOaDs+ixoeacquadpeeUqOaIt+S8muWmguS9leS9v+eUqOS6p+WTge+8jOacquadpeeahOeJqeWTgeWSjOS6uuS8muWmguS9leS6pOS6kuOAgiIsInN0YXR1cyI6InNoZWx2ZWQiLCJzaGVsZklkIjoid2VjaGF0XzA0IiwidGFncyI6WyLph43ngrkiXSwiaXNGZWF0dXJlZCI6dHJ1ZSwiY3JlYXRlZEF0Ijoi5LuK5aSpIDEyOjAwIn0seyJpZCI6IndlY2hhdF9wMDVfMDEiLCJjb250ZW50Ijoi5Lqn5ZOB6K6+6K6h6aaW5YWI5piv57uT5p6E6Zeu6aKY77yM54S25ZCO5omN5piv5Yqf6IO957uG6IqC44CCIiwic3RhdHVzIjoic2hlbHZlZCIsInNoZWxmSWQiOiJ3ZWNoYXRfMDUiLCJ0YWdzIjpbIumHjeeCuSJdLCJpc0ZlYXR1cmVkIjp0cnVlLCJjcmVhdGVkQXQiOiLku4rlpKkgMTI6MDAifSx7ImlkIjoid2VjaGF0X3AwNl8wMSIsImNvbnRlbnQiOiLmuIXmmbDmmJPmh4LvvIzkvZPnjrDpgLvovpHmuIXmpZoiLCJzdGF0dXMiOiJzaGVsdmVkIiwic2hlbGZJZCI6IndlY2hhdF8wNiIsInRhZ3MiOlsi6YeN54K5Il0sImlzRmVhdHVyZWQiOnRydWUsImNyZWF0ZWRBdCI6IuS7iuWkqSAxMjowMCJ9LHsiaWQiOiJ3ZWNoYXRfcDA2XzAyIiwiY29udGVudCI6IuS4jeaKrOmrmOiHquW3se+8jOaKiueUqOaIt+W9k+aci+WPiyIsInN0YXR1cyI6InNoZWx2ZWQiLCJzaGVsZklkIjoid2VjaGF0XzA2IiwidGFncyI6WyLmkZjlvZUiXSwiaXNGZWF0dXJlZCI6ZmFsc2UsImNyZWF0ZWRBdCI6IuS7iuWkqSAxMjowMCJ9LHsiaWQiOiJ3ZWNoYXRfcDA2XzAzIiwiY29udGVudCI6IuihqOi+vuato+ehru+8jOayoeacieatp+S5iSIsInN0YXR1cyI6InNoZWx2ZWQiLCJzaGVsZklkIjoid2VjaGF0XzA2IiwidGFncyI6WyLmkZjlvZUiXSwiaXNGZWF0dXJlZCI6ZmFsc2UsImNyZWF0ZWRBdCI6IuS7iuWkqSAxMjowMCJ9LHsiaWQiOiJ3ZWNoYXRfcDA2XzA0IiwiY29udGVudCI6IuWwvemHj+W8leeUqOeUqOaIt+iHquW3seeahOeUn+WKqOihqOi+viIsInN0YXR1cyI6InNoZWx2ZWQiLCJzaGVsZklkIjoid2VjaGF0XzA2IiwidGFncyI6WyLmkZjlvZUiXSwiaXNGZWF0dXJlZCI6ZmFsc2UsImNyZWF0ZWRBdCI6IuS7iuWkqSAxMjowMCJ9LHsiaWQiOiJ3ZWNoYXRfcDA3XzAxIiwiY29udGVudCI6IuS6p+WTgeacgOe7iOmdouWvueeahOaYr+S6uu+8jOiAjOS4jeaYr+aVsOaNruihqOmHjOeahOeUqOaIt+OAguS6p+WTgee7j+eQhumcgOimgemAj+i/h+aVsOaNrueci+WIsOS6uueahOS5oOaAp+OAgee+pOS9k+W/g+eQhuWSjOekvuS8muihjOS4uuOAgiIsInN0YXR1cyI6InNoZWx2ZWQiLCJzaGVsZklkIjoid2VjaGF0XzA3IiwidGFncyI6WyLph43ngrkiXSwiaXNGZWF0dXJlZCI6dHJ1ZSwiY3JlYXRlZEF0Ijoi5LuK5aSpIDEyOjAwIn0seyJpZCI6IndlY2hhdF9wMDhfMDEiLCJjb250ZW50Ijoi6ZyA5rGC5LiN5piv5p2l6Ieq6LCD56CU44CB5YiG5p6Q44CB6K6o6K6677yM5pu05LiN5piv5p2l6Ieq56ue5LqJ5a+55omL77yM6ICM5piv5p2l6Ieq5a+555So5oi355qE5LqG6Kej44CCIiwic3RhdHVzIjoic2hlbHZlZCIsInNoZWxmSWQiOiJ3ZWNoYXRfMDgiLCJ0YWdzIjpbIumHjeeCuSJdLCJpc0ZlYXR1cmVkIjp0cnVlLCJjcmVhdGVkQXQiOiLku4rlpKkgMTI6MDAifSx7ImlkIjoid2VjaGF0X3AwOV8wMSIsImNvbnRlbnQiOiLmj5Dpl67popjjgIHmjIfmiYvnlLvohJrlubbkuI3pmr7vvIzpmr7nmoTmmK/miorpl67popjmlbTnkIblh7rmnaXvvIzmib7liLDmnKzotKjjgIIiLCJzdGF0dXMiOiJzaGVsdmVkIiwic2hlbGZJZCI6IndlY2hhdF8wOSIsInRhZ3MiOlsi6YeN54K5Il0sImlzRmVhdHVyZWQiOnRydWUsImNyZWF0ZWRBdCI6IuS7iuWkqSAxMjowMCJ9LHsiaWQiOiJ3ZWNoYXRfcDEwXzAxIiwiY29udGVudCI6IuS6p+WTgeS4jeaYr+WKn+iDvea4heWNle+8jOiAjOaYr+iDveiHquaIkea8lOWMlueahOezu+e7n+OAgiIsInN0YXR1cyI6InNoZWx2ZWQiLCJzaGVsZklkIjoid2VjaGF0XzEwIiwidGFncyI6WyLph43ngrkiXSwiaXNGZWF0dXJlZCI6dHJ1ZSwiY3JlYXRlZEF0Ijoi5LuK5aSpIDEyOjAwIn0seyJpZCI6IndlY2hhdF9wMTBfMDIiLCJjb250ZW50Ijoi5Lqn5ZOB57uP55CG55qE5qC45b+D5bel5L2c5piv5Yib6YCg5py65Yi277yM6ICM5LiN5piv6KeE5YiS5omA5pyJ55So5oi36KGM5Li644CCIiwic3RhdHVzIjoic2hlbHZlZCIsInNoZWxmSWQiOiJ3ZWNoYXRfMTAiLCJ0YWdzIjpbIuaRmOW9lSJdLCJpc0ZlYXR1cmVkIjpmYWxzZSwiY3JlYXRlZEF0Ijoi5LuK5aSpIDEyOjAwIn0seyJpZCI6IndlY2hhdF9wMTBfMDMiLCJjb250ZW50Ijoi5Lqn5ZOB6KaB5pyJIEROQe+8jEROQSDmnaXoh6rku7flgLzop4LlkozorqTnn6XjgIIiLCJzdGF0dXMiOiJzaGVsdmVkIiwic2hlbGZJZCI6IndlY2hhdF8xMCIsInRhZ3MiOlsi5pGY5b2VIl0sImlzRmVhdHVyZWQiOmZhbHNlLCJjcmVhdGVkQXQiOiLku4rlpKkgMTI6MDAifSx7ImlkIjoid2VjaGF0X3AxMF8wNCIsImNvbnRlbnQiOiLlpb3kuqflk4HmnInmsJTotKjvvIzlg4/kuIDkuKrpgLvovpHmuIXmpZrjgIHlj43lupTmlY/mjbfjgIHosIjlkJDlvpfkvZPnmoTkurrjgIIiLCJzdGF0dXMiOiJzaGVsdmVkIiwic2hlbGZJZCI6IndlY2hhdF8xMCIsInRhZ3MiOlsi5pGY5b2VIl0sImlzRmVhdHVyZWQiOmZhbHNlLCJjcmVhdGVkQXQiOiLku4rlpKkgMTI6MDAifSx7ImlkIjoid2VjaGF0X3AxMF8wNSIsImNvbnRlbnQiOiLnu5PmnoTlhYjkuo7lip/og73vvIzliIbnsbvlkozmir3osaHlhrPlrprkuqflk4HmmK/lkKbmuIXmmbDjgIIiLCJzdGF0dXMiOiJzaGVsdmVkIiwic2hlbGZJZCI6IndlY2hhdF8xMCIsInRhZ3MiOlsi5pGY5b2VIl0sImlzRmVhdHVyZWQiOmZhbHNlLCJjcmVhdGVkQXQiOiLku4rlpKkgMTI6MDAifSx7ImlkIjoid2VjaGF0X3AxMF8wNiIsImNvbnRlbnQiOiLpnIDmsYLmnaXoh6rlr7nnlKjmiLfjgIHml7bku6PlkoznlJ/mtLvmva7mtYHnmoTnkIbop6PvvIzkuI3mnaXoh6rnq57kuonlr7nmiYvjgIIiLCJzdGF0dXMiOiJzaGVsdmVkIiwic2hlbGZJZCI6IndlY2hhdF8xMCIsInRhZ3MiOlsi5pGY5b2VIl0sImlzRmVhdHVyZWQiOmZhbHNlLCJjcmVhdGVkQXQiOiLku4rlpKkgMTI6MDAifSx7ImlkIjoid2VjaGF0X3AxMF8wNyIsImNvbnRlbnQiOiLkvZPpqozjgIHlk43lupTpgJ/luqbjgIHkurrmlofmhI/or4blkozlv4PnkIbmu6HotrPvvIzlvoDlvoDmr5Tlip/og73mlbDph4/mm7Tph43opoHjgIIiLCJzdGF0dXMiOiJzaGVsdmVkIiwic2hlbGZJZCI6IndlY2hhdF8xMCIsInRhZ3MiOlsi5pGY5b2VIl0sImlzRmVhdHVyZWQiOmZhbHNlLCJjcmVhdGVkQXQiOiLku4rlpKkgMTI6MDAifSx7ImlkIjoid2VjaGF0X3AxMF8wOCIsImNvbnRlbnQiOiLlpb3orr7orqHmmK/op6PlhrPpl67popjvvJvlpI3mnYLmlrnmoYjluLjluLjmhI/lkbPnnYDpl67popjlrprkuYnplJnkuobjgIIiLCJzdGF0dXMiOiJzaGVsdmVkIiwic2hlbGZJZCI6IndlY2hhdF8xMCIsInRhZ3MiOlsi5pGY5b2VIl0sImlzRmVhdHVyZWQiOmZhbHNlLCJjcmVhdGVkQXQiOiLku4rlpKkgMTI6MDAifSx7ImlkIjoid2VjaGF0X3AxMF8wOSIsImNvbnRlbnQiOiLkuqflk4Hnu4/nkIbopoHnkIbop6PkurrmgKfjgIHmi6XmirHlj5jljJbjgIHkv53mjIHlpb3lpYfvvIzmiorkuqflk4HlvZPkvZzlk4HmiZPno6jjgIIiLCJzdGF0dXMiOiJzaGVsdmVkIiwic2hlbGZJZCI6IndlY2hhdF8xMCIsInRhZ3MiOlsi5pGY5b2VIl0sImlzRmVhdHVyZWQiOmZhbHNlLCJjcmVhdGVkQXQiOiLku4rlpKkgMTI6MDAifV0sInNoZWx2ZXMiOlt7ImlkIjoid2VjaGF0XzAxIiwibmFtZSI6IuaguOW/g+S4u+e6vyIsImRlc2NyaXB0aW9uIjoi6L+Z5om56LWE5paZ55qE5qC45b+D5LiN5piv5Zyo6K6y5p+Q5Liq5YW35L2T5Yqf6IO95oCO5LmI5YGa77yM6ICM5piv5Zyo6K6y5LiA56eN5Lqn5ZOB6KeC77ya5Lqn5ZOB5LiN5piv5Yqf6IO96ZuG5ZCI77yM6ICM5piv5LiA5Liq5Lya6Ieq5oiR5ryU5YyW55qE57O757uf44CC5Lqn5ZOB57uP55CG55qE5bel5L2c5LiN5piv5oqK5omA5pyJ6Lev5b6E6KeE5YiS5q2777yM6ICM5piv5Yib6YCg5py65Yi244CB5aGR6YCg5Lu35YC86KeC44CB55CG6Kej5Lq65oCn77yM5bm26K6p55So5oi35Zyo57O757uf5Lit6Ieq54S255Sf6ZW/5Ye65pWF5LqL44CCIn0seyJpZCI6IndlY2hhdF8wMiIsIm5hbWUiOiLkuqflk4HmmK/kuIDlpZfkvJroh6rmiJHmvJTljJbnmoTns7vnu58iLCJkZXNjcmlwdGlvbiI6IuS6p+WTgee7j+eQhuS4jeWPquaYr+iuvuiuoeWKn+iDveeahOS6uu+8jOabtOWDj+aYr+WcqOWIm+mAoOS4gOS4quWPr+S7peiHquihjOi/kOi9rOeahOezu+e7n+OAguWlveeahOS6p+WTgeacuuWItuiDveiuqeeUqOaIt+iHquW3seWPkeeUn+aVheS6i+OAgeiHquW3seWIm+mAoOWGheWuueOAgeiHquW3seW9ouaIkOS9v+eUqOaWueW8j+OAgiJ9LHsiaWQiOiJ3ZWNoYXRfMDMiLCJuYW1lIjoi5Lqn5ZOB6ZyA6KaBIEROQSDlkozngbXprYIiLCJkZXNjcmlwdGlvbiI6IuS6p+WTgeeJueaAp+W5tuS4jeaYr+e6r+WuouinguaOqOWvvOWHuuadpeeahO+8jOWug+iDjOWQjuacieW+iOW8uueahOS4u+inguS7t+WAvOinguOAguS6p+WTgee7j+eQhuWSjOWboumYn+ebuOS/oeS7gOS5iOOAgeWPjeWvueS7gOS5iOOAgeaDs+aUueWPmOS7gOS5iO+8jOS8muebtOaOpei/m+WFpeS6p+WTgeOAgiJ9LHsiaWQiOiJ3ZWNoYXRfMDQiLCJuYW1lIjoi6Z2i5ZCR5pyq5p2l77yM6ICM5LiN5piv5Y+q5ZON5bqU5b2T5YmN6ZyA5rGCIiwiZGVzY3JpcHRpb24iOiLlgZrkuqflk4HkuI3og73lj6rkvp3otZblt7LmnInmlbDmja7lkoznu4/pqozjgILpnaLlr7nmnKrmnaXml7bvvIzpnIDopoHmmoLml7blv5jorrDml6fkuJbnlYznmoTmg6/mgKfvvIzph43mlrDmtJ7lr5/otovlir/vvIzmg7PosaHmnKrmnaXnlKjmiLfkvJrlpoLkvZXkvb/nlKjkuqflk4HvvIzmnKrmnaXnmoTnianlk4HlkozkurrkvJrlpoLkvZXkuqTkupLjgIIifSx7ImlkIjoid2VjaGF0XzA1IiwibmFtZSI6IuWBmuS6p+WTgeeahOaWueazlSIsImRlc2NyaXB0aW9uIjoi5Lqn5ZOB6K6+6K6h6aaW5YWI5piv57uT5p6E6Zeu6aKY77yM54S25ZCO5omN5piv5Yqf6IO957uG6IqC44CCIn0seyJpZCI6IndlY2hhdF8wNiIsIm5hbWUiOiLkvZPpqozjgIHmlofmoYjkuI4gVUkiLCJkZXNjcmlwdGlvbiI6IuaTjeS9nOWTjeW6lOmAn+W6puawuOi/nOaYr+esrOS4gOS9k+mqjOOAguaKiueUqOaIt+S9k+mqjOWBmuWIsOaegeiHtO+8jOacrOi6q+WwseaYr+WIm+aWsOOAgiJ9LHsiaWQiOiJ3ZWNoYXRfMDciLCJuYW1lIjoi5Lq65oCn44CB5a2Y5Zyo5oSf5LiO55So5oi35b+D55CGIiwiZGVzY3JpcHRpb24iOiLkuqflk4HmnIDnu4jpnaLlr7nnmoTmmK/kurrvvIzogIzkuI3mmK/mlbDmja7ooajph4znmoTnlKjmiLfjgILkuqflk4Hnu4/nkIbpnIDopoHpgI/ov4fmlbDmja7nnIvliLDkurrnmoTkuaDmgKfjgIHnvqTkvZPlv4PnkIblkoznpL7kvJrooYzkuLrjgIIifSx7ImlkIjoid2VjaGF0XzA4IiwibmFtZSI6IumcgOaxguS7juWTqumHjOadpSIsImRlc2NyaXB0aW9uIjoi6ZyA5rGC5LiN5piv5p2l6Ieq6LCD56CU44CB5YiG5p6Q44CB6K6o6K6677yM5pu05LiN5piv5p2l6Ieq56ue5LqJ5a+55omL77yM6ICM5piv5p2l6Ieq5a+555So5oi355qE5LqG6Kej44CCIn0seyJpZCI6IndlY2hhdF8wOSIsIm5hbWUiOiLkuqflk4Hnu4/nkIbnmoTkv67lhbsiLCJkZXNjcmlwdGlvbiI6IuaPkOmXrumimOOAgeaMh+aJi+eUu+iEmuW5tuS4jemavu+8jOmavueahOaYr+aKiumXrumimOaVtOeQhuWHuuadpe+8jOaJvuWIsOacrOi0qOOAgiJ9LHsiaWQiOiJ3ZWNoYXRfMTAiLCJuYW1lIjoi5YWz6ZSu57uT6K66IiwiZGVzY3JpcHRpb24iOiLkuqflk4HkuI3mmK/lip/og73muIXljZXvvIzogIzmmK/og73oh6rmiJHmvJTljJbnmoTns7vnu5/jgIIifV0sInJldmlld0RvY3VtZW50Ijp7InRpdGxlIjoi44CK5b6u5L+h6IOM5ZCO55qE5Lqn5ZOB6KeC44CLIiwic2VjdGlvbnMiOlt7InNoZWxmSWQiOiJ3ZWNoYXRfMDEiLCJoZWFkaW5nIjoi5qC45b+D5Li757q/Iiwic3VtbWFyeSI6Iui/meaJuei1hOaWmeeahOaguOW/g+S4jeaYr+WcqOiusuafkOS4quWFt+S9k+WKn+iDveaAjuS5iOWBmu+8jOiAjOaYr+WcqOiusuS4gOenjeS6p+WTgeingu+8muS6p+WTgeS4jeaYr+WKn+iDvembhuWQiO+8jOiAjOaYr+S4gOS4quS8muiHquaIkea8lOWMlueahOezu+e7n+OAguS6p+WTgee7j+eQhueahOW3peS9nOS4jeaYr+aKiuaJgOaciei3r+W+hOinhOWIkuatu++8jOiAjOaYr+WIm+mAoOacuuWItuOAgeWhkemAoOS7t+WAvOinguOAgeeQhuino+S6uuaAp++8jOW5tuiuqeeUqOaIt+WcqOezu+e7n+S4reiHqueEtueUn+mVv+WHuuaVheS6i+OAgiIsImJ1bGxldHMiOlt7InRleHQiOiLkuqflk4HlupTlg4/kuIDkuKrns7vnu5/vvIzogIzkuI3mmK/kuIDkuKrlip/og73muIXljZXjgIIiLCJwaW5lY29uZUlkcyI6WyJ3ZWNoYXRfcDAxXzAxIl19LHsidGV4dCI6IuS6p+WTgeimgeacieiHquW3seeahCBETkHvvIzkuZ/lsLHmmK/ku7flgLzop4LlkozorqTnn6XjgIIiLCJwaW5lY29uZUlkcyI6WyJ3ZWNoYXRfcDAxXzAyIl19LHsidGV4dCI6IumdouWQkeacquadpeWSjOWcuuaZr+iuvuiuoe+8jOiAjOS4jeaYr+WPquWTjeW6lOW9k+WJjemcgOaxguOAgiIsInBpbmVjb25lSWRzIjpbIndlY2hhdF9wMDFfMDMiXX0seyJ0ZXh0Ijoi5L2T6aqM44CB5rCU6LSo5ZKM5Lq65paH5oSP6K+G5q+U5aCG5Yqf6IO95pu06YeN6KaB44CCIiwicGluZWNvbmVJZHMiOlsid2VjaGF0X3AwMV8wNCJdfSx7InRleHQiOiLkuqflk4Hnu4/nkIbopoHnkIbop6PkurrjgIHmi6XmirHkuI3noa7lrprmgKfvvIzlubbmiorkuqflk4HlvZPkvZzlk4Hpm5XliLvjgIIiLCJwaW5lY29uZUlkcyI6WyJ3ZWNoYXRfcDAxXzA1Il19XX0seyJzaGVsZklkIjoid2VjaGF0XzAyIiwiaGVhZGluZyI6IuS6p+WTgeaYr+S4gOWll+S8muiHquaIkea8lOWMlueahOezu+e7nyIsInN1bW1hcnkiOiLkuqflk4Hnu4/nkIbkuI3lj6rmmK/orr7orqHlip/og73nmoTkurrvvIzmm7Tlg4/mmK/lnKjliJvpgKDkuIDkuKrlj6/ku6Xoh6rooYzov5DovaznmoTns7vnu5/jgILlpb3nmoTkuqflk4HmnLrliLbog73orqnnlKjmiLfoh6rlt7Hlj5HnlJ/mlYXkuovjgIHoh6rlt7HliJvpgKDlhoXlrrnjgIHoh6rlt7HlvaLmiJDkvb/nlKjmlrnlvI/jgIIiLCJidWxsZXRzIjpbeyJ0ZXh0Ijoi5Lqn5ZOB57uP55CG5LiN5Y+q5piv6K6+6K6h5Yqf6IO955qE5Lq677yM5pu05YOP5piv5Zyo5Yib6YCg5LiA5Liq5Y+v5Lul6Ieq6KGM6L+Q6L2s55qE57O757uf44CC5aW955qE5Lqn5ZOB5py65Yi26IO96K6p55So5oi36Ieq5bex5Y+R55Sf5pWF5LqL44CB6Ieq5bex5Yib6YCg5YaF5a6544CB6Ieq5bex5b2i5oiQ5L2/55So5pa55byP44CCIiwicGluZWNvbmVJZHMiOlsid2VjaGF0X3AwMl8wMSJdfV19LHsic2hlbGZJZCI6IndlY2hhdF8wMyIsImhlYWRpbmciOiLkuqflk4HpnIDopoEgRE5BIOWSjOeBtemtgiIsInN1bW1hcnkiOiLkuqflk4HnibnmgKflubbkuI3mmK/nuq/lrqLop4Lmjqjlr7zlh7rmnaXnmoTvvIzlroPog4zlkI7mnInlvojlvLrnmoTkuLvop4Lku7flgLzop4LjgILkuqflk4Hnu4/nkIblkozlm6LpmJ/nm7jkv6Hku4DkuYjjgIHlj43lr7nku4DkuYjjgIHmg7PmlLnlj5jku4DkuYjvvIzkvJrnm7TmjqXov5vlhaXkuqflk4HjgIIiLCJidWxsZXRzIjpbeyJ0ZXh0Ijoi5pW05L2T5ZKM6LCQ77yM6ICM5LiN5piv57K+56We5YiG6KOCIiwicGluZWNvbmVJZHMiOlsid2VjaGF0X3AwM18wMSJdfSx7InRleHQiOiLnu5PmnoTmuIXmmbDvvIzlip/og73kuYvpl7TmnInmnLrogZTns7siLCJwaW5lY29uZUlkcyI6WyJ3ZWNoYXRfcDAzXzAyIl19LHsidGV4dCI6IuWKn+iDveacieWKm+mHj++8jOWDj+S6uueahOiCjOiCiSIsInBpbmVjb25lSWRzIjpbIndlY2hhdF9wMDNfMDMiXX0seyJ0ZXh0Ijoi5Lqk5LqS55CG5oCn44CB6YC76L6R5riF5qWa44CB5Y+N5bqU5pWP5o23IiwicGluZWNvbmVJZHMiOlsid2VjaGF0X3AwM18wNCJdfSx7InRleHQiOiLmlofmoYjlvpfkvZPvvIzlg4/kuIDkuKrkvJrlpb3lpb3or7Tor53nmoTkuroiLCJwaW5lY29uZUlkcyI6WyJ3ZWNoYXRfcDAzXzA1Il19LHsidGV4dCI6IuiDjOWQjuacieeos+WumuS7t+WAvOingu+8jOiAjOS4jeaYr+maj+WKn+iDveaRh+aRhiIsInBpbmVjb25lSWRzIjpbIndlY2hhdF9wMDNfMDYiXX1dfSx7InNoZWxmSWQiOiJ3ZWNoYXRfMDQiLCJoZWFkaW5nIjoi6Z2i5ZCR5pyq5p2l77yM6ICM5LiN5piv5Y+q5ZON5bqU5b2T5YmN6ZyA5rGCIiwic3VtbWFyeSI6IuWBmuS6p+WTgeS4jeiDveWPquS+nei1luW3suacieaVsOaNruWSjOe7j+mqjOOAgumdouWvueacquadpeaXtu+8jOmcgOimgeaaguaXtuW/mOiusOaXp+S4lueVjOeahOaDr+aAp++8jOmHjeaWsOa0nuWvn+i2i+WKv++8jOaDs+ixoeacquadpeeUqOaIt+S8muWmguS9leS9v+eUqOS6p+WTge+8jOacquadpeeahOeJqeWTgeWSjOS6uuS8muWmguS9leS6pOS6kuOAgiIsImJ1bGxldHMiOlt7InRleHQiOiLlgZrkuqflk4HkuI3og73lj6rkvp3otZblt7LmnInmlbDmja7lkoznu4/pqozjgILpnaLlr7nmnKrmnaXml7bvvIzpnIDopoHmmoLml7blv5jorrDml6fkuJbnlYznmoTmg6/mgKfvvIzph43mlrDmtJ7lr5/otovlir/vvIzmg7PosaHmnKrmnaXnlKjmiLfkvJrlpoLkvZXkvb/nlKjkuqflk4HvvIzmnKrmnaXnmoTnianlk4HlkozkurrkvJrlpoLkvZXkuqTkupLjgIIiLCJwaW5lY29uZUlkcyI6WyJ3ZWNoYXRfcDA0XzAxIl19XX0seyJzaGVsZklkIjoid2VjaGF0XzA1IiwiaGVhZGluZyI6IuWBmuS6p+WTgeeahOaWueazlSIsInN1bW1hcnkiOiLkuqflk4Horr7orqHpppblhYjmmK/nu5PmnoTpl67popjvvIznhLblkI7miY3mmK/lip/og73nu4boioLjgIIiLCJidWxsZXRzIjpbeyJ0ZXh0Ijoi5Lqn5ZOB6K6+6K6h6aaW5YWI5piv57uT5p6E6Zeu6aKY77yM54S25ZCO5omN5piv5Yqf6IO957uG6IqC44CCIiwicGluZWNvbmVJZHMiOlsid2VjaGF0X3AwNV8wMSJdfV19LHsic2hlbGZJZCI6IndlY2hhdF8wNiIsImhlYWRpbmciOiLkvZPpqozjgIHmlofmoYjkuI4gVUkiLCJzdW1tYXJ5Ijoi5pON5L2c5ZON5bqU6YCf5bqm5rC46L+c5piv56ys5LiA5L2T6aqM44CC5oqK55So5oi35L2T6aqM5YGa5Yiw5p6B6Ie077yM5pys6Lqr5bCx5piv5Yib5paw44CCIiwiYnVsbGV0cyI6W3sidGV4dCI6Iua4heaZsOaYk+aHgu+8jOS9k+eOsOmAu+i+kea4healmiIsInBpbmVjb25lSWRzIjpbIndlY2hhdF9wMDZfMDEiXX0seyJ0ZXh0Ijoi5LiN5oqs6auY6Ieq5bex77yM5oqK55So5oi35b2T5pyL5Y+LIiwicGluZWNvbmVJZHMiOlsid2VjaGF0X3AwNl8wMiJdfSx7InRleHQiOiLooajovr7mraPnoa7vvIzmsqHmnInmrafkuYkiLCJwaW5lY29uZUlkcyI6WyJ3ZWNoYXRfcDA2XzAzIl19LHsidGV4dCI6IuWwvemHj+W8leeUqOeUqOaIt+iHquW3seeahOeUn+WKqOihqOi+viIsInBpbmVjb25lSWRzIjpbIndlY2hhdF9wMDZfMDQiXX1dfSx7InNoZWxmSWQiOiJ3ZWNoYXRfMDciLCJoZWFkaW5nIjoi5Lq65oCn44CB5a2Y5Zyo5oSf5LiO55So5oi35b+D55CGIiwic3VtbWFyeSI6IuS6p+WTgeacgOe7iOmdouWvueeahOaYr+S6uu+8jOiAjOS4jeaYr+aVsOaNruihqOmHjOeahOeUqOaIt+OAguS6p+WTgee7j+eQhumcgOimgemAj+i/h+aVsOaNrueci+WIsOS6uueahOS5oOaAp+OAgee+pOS9k+W/g+eQhuWSjOekvuS8muihjOS4uuOAgiIsImJ1bGxldHMiOlt7InRleHQiOiLkuqflk4HmnIDnu4jpnaLlr7nnmoTmmK/kurrvvIzogIzkuI3mmK/mlbDmja7ooajph4znmoTnlKjmiLfjgILkuqflk4Hnu4/nkIbpnIDopoHpgI/ov4fmlbDmja7nnIvliLDkurrnmoTkuaDmgKfjgIHnvqTkvZPlv4PnkIblkoznpL7kvJrooYzkuLrjgIIiLCJwaW5lY29uZUlkcyI6WyJ3ZWNoYXRfcDA3XzAxIl19XX0seyJzaGVsZklkIjoid2VjaGF0XzA4IiwiaGVhZGluZyI6IumcgOaxguS7juWTqumHjOadpSIsInN1bW1hcnkiOiLpnIDmsYLkuI3mmK/mnaXoh6rosIPnoJTjgIHliIbmnpDjgIHorqjorrrvvIzmm7TkuI3mmK/mnaXoh6rnq57kuonlr7nmiYvvvIzogIzmmK/mnaXoh6rlr7nnlKjmiLfnmoTkuobop6PjgIIiLCJidWxsZXRzIjpbeyJ0ZXh0Ijoi6ZyA5rGC5LiN5piv5p2l6Ieq6LCD56CU44CB5YiG5p6Q44CB6K6o6K6677yM5pu05LiN5piv5p2l6Ieq56ue5LqJ5a+55omL77yM6ICM5piv5p2l6Ieq5a+555So5oi355qE5LqG6Kej44CCIiwicGluZWNvbmVJZHMiOlsid2VjaGF0X3AwOF8wMSJdfV19LHsic2hlbGZJZCI6IndlY2hhdF8wOSIsImhlYWRpbmciOiLkuqflk4Hnu4/nkIbnmoTkv67lhbsiLCJzdW1tYXJ5Ijoi5o+Q6Zeu6aKY44CB5oyH5omL55S76ISa5bm25LiN6Zq+77yM6Zq+55qE5piv5oqK6Zeu6aKY5pW055CG5Ye65p2l77yM5om+5Yiw5pys6LSo44CCIiwiYnVsbGV0cyI6W3sidGV4dCI6IuaPkOmXrumimOOAgeaMh+aJi+eUu+iEmuW5tuS4jemavu+8jOmavueahOaYr+aKiumXrumimOaVtOeQhuWHuuadpe+8jOaJvuWIsOacrOi0qOOAgiIsInBpbmVjb25lSWRzIjpbIndlY2hhdF9wMDlfMDEiXX1dfSx7InNoZWxmSWQiOiJ3ZWNoYXRfMTAiLCJoZWFkaW5nIjoi5YWz6ZSu57uT6K66Iiwic3VtbWFyeSI6IuS6p+WTgeS4jeaYr+WKn+iDvea4heWNle+8jOiAjOaYr+iDveiHquaIkea8lOWMlueahOezu+e7n+OAgiIsImJ1bGxldHMiOlt7InRleHQiOiLkuqflk4HkuI3mmK/lip/og73muIXljZXvvIzogIzmmK/og73oh6rmiJHmvJTljJbnmoTns7vnu5/jgIIiLCJwaW5lY29uZUlkcyI6WyJ3ZWNoYXRfcDEwXzAxIl19LHsidGV4dCI6IuS6p+WTgee7j+eQhueahOaguOW/g+W3peS9nOaYr+WIm+mAoOacuuWItu+8jOiAjOS4jeaYr+inhOWIkuaJgOacieeUqOaIt+ihjOS4uuOAgiIsInBpbmVjb25lSWRzIjpbIndlY2hhdF9wMTBfMDIiXX0seyJ0ZXh0Ijoi5Lqn5ZOB6KaB5pyJIEROQe+8jEROQSDmnaXoh6rku7flgLzop4LlkozorqTnn6XjgIIiLCJwaW5lY29uZUlkcyI6WyJ3ZWNoYXRfcDEwXzAzIl19LHsidGV4dCI6IuWlveS6p+WTgeacieawlOi0qO+8jOWDj+S4gOS4qumAu+i+kea4healmuOAgeWPjeW6lOaVj+aNt+OAgeiwiOWQkOW+l+S9k+eahOS6uuOAgiIsInBpbmVjb25lSWRzIjpbIndlY2hhdF9wMTBfMDQiXX0seyJ0ZXh0Ijoi57uT5p6E5YWI5LqO5Yqf6IO977yM5YiG57G75ZKM5oq96LGh5Yaz5a6a5Lqn5ZOB5piv5ZCm5riF5pmw44CCIiwicGluZWNvbmVJZHMiOlsid2VjaGF0X3AxMF8wNSJdfSx7InRleHQiOiLpnIDmsYLmnaXoh6rlr7nnlKjmiLfjgIHml7bku6PlkoznlJ/mtLvmva7mtYHnmoTnkIbop6PvvIzkuI3mnaXoh6rnq57kuonlr7nmiYvjgIIiLCJwaW5lY29uZUlkcyI6WyJ3ZWNoYXRfcDEwXzA2Il19XX1dfX0="), (char) => char.charCodeAt(0))));

const initialState = {
  version: 7,
  activeWarehouseId: "wechat_product_philosophy",
  query: "",
  shelfOpen: false,
  addOpen: false,
  editMode: false,
  newPineconeText: "",
  shelfQuery: "",
  documentDraft: null,
  organizingWarehouseId: null,
  referenceIds: [],
  warehouseDialog: null,
  toast: "",
  warehouses: [
    makeWechatProductWarehouse(),
    ...exampleWarehouses,
    {
      id: "interview",
      name: "面试经验整理",
      updatedAt: "今天 10:30 更新",
      pinecones: [
        { id: "p1", content: "项目经历要写清楚背景、行动和结果，不要只堆技术名词。", status: "shelved", shelfId: "resume", tags: ["重点"], isFeatured: true, createdAt: "07-12 09:41" },
        { id: "p2", content: "简历内容要围绕目标岗位展开，减少无关经历。", status: "shelved", shelfId: "resume", tags: ["可执行"], isFeatured: true, createdAt: "07-12 08:22" },
        { id: "p3", content: "提前把岗位、公司、作品和自我介绍放进同一条线，现场表达会更稳定。", status: "shelved", shelfId: "before", tags: ["重点"], isFeatured: true, createdAt: "07-11 22:15" },
        { id: "p4", content: "每个项目准备 1 分钟版本和 3 分钟展开版本。", status: "shelved", shelfId: "resume", tags: ["可执行"], isFeatured: true, createdAt: "07-11 16:05" },
        { id: "p5", content: "回答问题时先给结论，再补充判断过程和具体例子。", status: "shelved", shelfId: "performance", tags: ["重点"], isFeatured: true, createdAt: "07-11 11:20" },
        { id: "p6", content: "遇到不会的问题，可以说明思路边界，再讲自己会如何继续验证。", status: "shelved", shelfId: "performance", tags: ["可执行"], isFeatured: true, createdAt: "07-11 10:08" },
        { id: "p7", content: "常见问题要提前准备结构，不要背完整稿，避免现场僵硬。", status: "shelved", shelfId: "qa", tags: ["高频"], isFeatured: true, createdAt: "07-10 22:40" },
        { id: "p8", content: "反问环节优先问团队目标、评价标准和岗位真实挑战。", status: "shelved", shelfId: "qa", tags: ["重点"], isFeatured: true, createdAt: "07-10 21:55" },
        { id: "p9", content: "面试后记录被追问最多的部分，下一轮重点补齐。", status: "shelved", shelfId: "follow", tags: ["复盘"], isFeatured: true, createdAt: "07-10 21:10" },
        { id: "p10", content: "每轮结束后写下自己卡住的表达，下一次用更短的句子重讲。", status: "shelved", shelfId: "follow", tags: ["复盘"], isFeatured: true, createdAt: "07-10 20:36" },
        { id: "p11", content: "零散经验先放在补充区，等相似内容多了再合并进正式章节。", status: "shelved", shelfId: "other", tags: ["补充"], isFeatured: true, createdAt: "07-09 18:20" },
        { id: "p12", content: "不确定是否重要的提醒先保留引用，后续复盘时再决定取舍。", status: "shelved", shelfId: "other", tags: ["补充"], isFeatured: true, createdAt: "07-09 17:44" },
      ],
      shelves: [
        { id: "resume", name: "简历准备", description: "把经历整理成岗位能快速理解的讲述线。" },
        { id: "before", name: "面试前准备", description: "让岗位、公司和自我介绍提前对齐。" },
        { id: "performance", name: "面试中的表现", description: "现场表达要稳定、清楚、有来有回。" },
        { id: "qa", name: "常见问题回答思路", description: "把高频问题整理成可复用答案。" },
        { id: "follow", name: "面试后的跟进", description: "用复盘记录修正下一次表达。" },
        { id: "other", name: "其他经验补充", description: "暂时无法归入前面章节的经验。" },
      ],
      reviewDocument: {
        title: "面试经验整理",
        sections: [
          {
            shelfId: "resume",
            heading: "简历准备",
            summary: "简历不是经历堆叠，而是让面试官快速理解你与岗位的关系。",
            bullets: [
              { text: "把项目写成背景、行动、结果的清晰故事，减少空泛技术名词。", pineconeIds: ["p1"] },
              { text: "围绕目标岗位调整表达，让重点经历先被看见。", pineconeIds: ["p2"] },
              { text: "为每个项目准备 1 分钟版本和 3 分钟展开版本。", pineconeIds: ["p4"] },
            ],
          },
          {
            shelfId: "before",
            heading: "面试前准备",
            summary: "提前把岗位、公司、作品和自我介绍放进同一条线，现场表达会更稳定。",
            bullets: [
              { text: "自我介绍先给结论，再补充最能证明匹配度的经历。", pineconeIds: ["p3"] },
              { text: "准备常见问题时，重点整理自己的判断过程和反问要点。", pineconeIds: ["p3"] },
            ],
          },
          {
            shelfId: "performance",
            heading: "面试中的表现",
            summary: "现场表达要稳定、清楚、有来有回，先把对方的问题接住。",
            bullets: [
              { text: "回答问题时先给结论，再补充判断过程和具体例子。", pineconeIds: ["p5"] },
              { text: "遇到不会的问题，说明思路边界并讲清后续验证方式。", pineconeIds: ["p6"] },
            ],
          },
          {
            shelfId: "qa",
            heading: "常见问题回答思路",
            summary: "高频问题不需要背稿，更适合整理成可复用的回答结构。",
            bullets: [
              { text: "提前准备问题结构，保留自然表达空间。", pineconeIds: ["p7"] },
              { text: "反问优先围绕团队目标、评价标准和岗位挑战。", pineconeIds: ["p8"] },
            ],
          },
          {
            shelfId: "follow",
            heading: "面试后的跟进",
            summary: "把被追问和表达卡住的地方记录下来，下一轮有明确补齐点。",
            bullets: [
              { text: "记录被追问最多的部分，下一轮重点补齐。", pineconeIds: ["p9"] },
              { text: "用更短的句子重讲卡住的表达。", pineconeIds: ["p10"] },
            ],
          },
          {
            shelfId: "other",
            heading: "其他经验补充",
            summary: "暂时无法归类的提醒先保留引用，等内容变多后再合并。",
            bullets: [
              { text: "相似经验积累到一定数量后再并入正式章节。", pineconeIds: ["p11"] },
              { text: "不确定是否重要的提醒先保留引用。", pineconeIds: ["p12"] },
            ],
          },
        ],
      },
    },
    makeWarehouse("reading", "《被讨厌的勇气》摘抄", "昨天 21:15 更新", [
      "课题分离能让人分清自己的选择和他人的评价。",
      "自由常常伴随被评价的风险。",
      "自我接纳不是放弃，而是从真实处境开始行动。",
    ]),
    makeWarehouse("product", "产品设计灵感", "07-11 16:40 更新", [
      "用户想保存和复盘，而不是先填写目标或选择模板。",
      "复盘文档越像自然文章，越需要保留原始松果入口。",
    ]),
    makeWarehouse("study", "工作学习笔记", "07-10 09:20 更新", [
      "把模糊任务拆成可执行的下一步，能降低开始成本。",
      "等待外部反馈的事项要单独标出。",
    ]),
    makeWarehouse("life", "生活中的小确幸", "07-09 22:18 更新", [
      "记录当时的场景，比只写结论更容易唤起记忆。",
      "同类小事可以归到同一个章节里。",
    ]),
  ],
};

let state = loadState();
const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
let draggedWarehouseId = "";
let warehouseDragStartedFromButton = false;
let touchWarehouseDrag = null;
let warehouseAutoScrollFrame = 0;

document.addEventListener("touchmove", preventActiveWarehouseTouchScroll, { passive: false });
render();

function makeWarehouse(id, name, updatedAt, contents) {
  const pinecones = contents.map((content, index) => ({
    id: `${id}_p${index + 1}`,
    content,
    status: "shelved",
    shelfId: index === 0 ? "main" : "notes",
    tags: index === 0 ? ["重点"] : ["摘录"],
    isFeatured: index === 0,
    createdAt: `07-${12 - index} ${index ? "21:15" : "16:40"}`,
  }));

  return {
    id,
    name,
    updatedAt,
    pinecones,
    shelves: [
      { id: "main", name: name.includes("摘抄") ? "核心观点" : "主要线索", description: "最适合放入复盘文档的内容。" },
      { id: "notes", name: "补充记录", description: "保留上下文和后续可展开的材料。" },
    ],
    reviewDocument: buildReviewDocument(name, [
      {
        shelfId: "main",
        heading: name.includes("摘抄") ? "先把关键观点收拢起来" : "先抓住最重要的线索",
        summary: "这部分把当前仓库里最值得回看的松果整理成一段清楚的复盘。",
        bullets: pinecones.slice(0, 2).map((pinecone) => ({ text: pinecone.content, pineconeIds: [pinecone.id] })),
      },
    ]),
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    const normalized = normalizeWarehouseState(saved || initialState, initialState.version);
    const migrated = useOnlyExampleWarehouses(normalized, exampleWarehouses, EXAMPLE_COLLECTION_VERSION);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    return resetTransientState(migrated);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }

  const normalized = normalizeWarehouseState(initialState, initialState.version);
  const migrated = useOnlyExampleWarehouses(normalized, exampleWarehouses, EXAMPLE_COLLECTION_VERSION);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
  return resetTransientState(migrated);
}

function resetTransientState(nextState) {
  return {
    ...nextState,
    toast: "",
    referenceIds: [],
    newPineconeText: "",
    shelfQuery: "",
    pineconeDrafts: {},
    shelfManaging: false,
    documentDraft: null,
    organizingWarehouseId: null,
    warehouseDialog: null,
  };
}

function saveState() {
  const {
    toast: _toast,
    referenceIds: _referenceIds,
    editMode: _editMode,
    documentDraft: _documentDraft,
    organizingWarehouseId: _organizingWarehouseId,
    warehouseDialog: _warehouseDialog,
    shelfManaging: _shelfManaging,
    pineconeDrafts: _pineconeDrafts,
    ...persisted
  } = state;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
}

function getActiveWarehouse() {
  if (state.editMode && state.documentDraft?.id === state.activeWarehouseId) return state.documentDraft;
  return hydrateWarehouseRecord(state, state.activeWarehouseId)
    || getWarehouseList()[0]
    || null;
}

function getWarehouseList() {
  return getWarehouseRecords(state);
}

function commitWarehouse(warehouse) {
  state = persistWarehouseRecord(state, warehouse);
}

function isActiveWarehouseOrganizing() {
  return isWarehouseReadOnly(state.organizingWarehouseId, state.activeWarehouseId);
}

function render() {
  const warehouse = getActiveWarehouse();
  if (!warehouse) {
    app.innerHTML = renderEmptyWarehouseState();
    bindEvents();
    renderToast();
    return;
  }

  const tempCount = warehouse.pinecones.filter((pinecone) => pinecone.status === "temp").length;

  app.innerHTML = `
    <section class="page-shell" ${state.warehouseDialog ? "inert" : ""}>
      <header class="topbar">
        <div class="brand">
          ${icons.logo("brand-squirrel")}
          <div>
            <h1>松鼠文仓</h1>
            <p>把零散信息整理成结构化文档 ${icons.leaf("brand-leaf")}</p>
          </div>
        </div>
      </header>

      <aside class="warehouse-panel">
        <div class="panel-head">
          <h2>松果仓列表</h2>
          <button class="icon-button green" type="button" data-action="create-warehouse" aria-label="新建松果仓">${icons.plus("icon-img")}</button>
        </div>
        <div class="warehouse-list">
          ${getWarehouseList().map(renderWarehouseCard).join("")}
        </div>
      </aside>

      <main class="document-panel">
        <section class="document-card">
          <header class="doc-head">
            <div class="doc-title">
              ${renderWarehouseIcon(warehouse).replace("warehouse-icon", "book-icon")}
              <div>
                <h2>${escapeHtml(warehouse.reviewDocument.title)}</h2>
              </div>
            </div>
            ${renderToolbar()}
            <div class="chips">
              <span>${icons.book("chip-img")} ${warehouse.reviewDocument.sections.length} 个章节</span>
              <span><b class="clock-dot"></b>${escapeHtml(warehouse.updatedAt)}</span>
              <span>暂存栏 ${tempCount} 颗</span>
            </div>
          </header>

          <div class="content-wrap">
            <nav class="toc" aria-label="目录">
              <h3>目录</h3>
              ${warehouse.reviewDocument.sections.map((section, index) => `
                <button class="${index === 0 ? "active" : ""}" type="button" data-action="jump-section" data-section-index="${index}">
                  <span>${index + 1}. ${escapeHtml(section.heading)}</span>
                  ${index === 0 ? "<b></b>" : ""}
                </button>
              `).join("")}
            </nav>
            <article class="review-doc">
              ${renderReviewDocument(warehouse)}
            </article>
          </div>

          ${state.addOpen ? renderAddPanel(warehouse) : ""}
          ${renderShelfDrawer(warehouse)}

        </section>
      </main>
    </section>

    ${state.warehouseDialog ? renderWarehouseDialog() : ""}
  `;

  bindEvents();
  renderToast();
}

function renderEmptyWarehouseState() {
  return `
    <section class="page-shell empty-warehouse-shell" ${state.warehouseDialog ? "inert" : ""}>
      <header class="topbar">
        <div class="brand">
          ${icons.logo("brand-squirrel")}
          <div>
            <h1>松鼠文仓</h1>
          <p>把零散信息整理成结构化文档 ${icons.leaf("brand-leaf")}</p>
          </div>
        </div>
      </header>
      <main class="warehouse-empty-state">
        ${icons.logo("empty-warehouse-squirrel")}
        <h2>还没有松鼠仓</h2>
        <p>新建一个松鼠仓，开始收集和整理松果。</p>
        <button class="primary-button" type="button" data-action="create-warehouse">新建松鼠仓</button>
      </main>
    </section>
    ${state.warehouseDialog ? renderWarehouseDialog() : ""}
  `;
}

function renderWarehouseCard(warehouse) {
  const active = warehouse.id === state.activeWarehouseId;
  const locked = isWarehouseReadOnly(state.organizingWarehouseId, warehouse.id);
  return `
    <article class="warehouse-card ${active ? "active" : ""}"
      data-warehouse-card="${warehouse.id}" draggable="${state.organizingWarehouseId ? "false" : "true"}">
      <span class="warehouse-icon-button" aria-hidden="true">
        ${renderWarehouseIcon(warehouse)}
      </span>
      <button class="warehouse-copy" type="button" data-warehouse="${warehouse.id}">
        <strong>${escapeHtml(warehouse.name)}</strong>
        <small>${escapeHtml(warehouse.updatedAt)}</small>
      </button>
      ${active ? '<i class="active-dot"></i>' : ""}
      <button class="warehouse-delete-button" type="button"
        data-action="delete-warehouse" data-warehouse-id="${warehouse.id}"
        aria-label="删除 ${escapeHtml(warehouse.name)}" ${locked ? "disabled" : ""}>×</button>
    </article>
  `;
}

function renderWarehouseIcon(warehouse) {
  const color = warehouse.id.startsWith("example_") ? "wood" : getWarehouseColor(warehouse.name);
  return asset("pinecone-warehouse-icon.png", `warehouse-icon warehouse-color-${color}`);
}

function renderShelfIcon(className) {
  return asset("pinecone-shelf-icon.png", className);
}

function renderToolbar() {
  const readOnly = isActiveWarehouseOrganizing();
  const warehouse = getActiveWarehouse();
  const canOrganize = canStartWarehouseOrganization(state.organizingWarehouseId, warehouse);
  return `
    <img class="document-mascot" src="assets/illustrations/squirrel-toolbar-perched-v2.png" alt="" aria-hidden="true">
    <nav class="document-corner-tools" aria-label="文档工具" data-toolbar>
      <button class="corner-tool" type="button" data-action="toggle-add" aria-label="添加松果" title="添加松果" ${readOnly ? "disabled" : ""}><span class="toolbar-icon-box">${icons.plus("toolbar-img add")}</span><span class="corner-tool-label">添加松果</span></button>
      <button class="corner-tool" type="button" data-action="toggle-document-edit" aria-label="${state.editMode ? "保存文档" : "编辑文档"}" title="${state.editMode ? "保存文档" : "编辑文档"}" ${readOnly ? "disabled" : ""}><span class="toolbar-icon-box">${icons.book("toolbar-img")}</span><span class="corner-tool-label">${state.editMode ? "保存文档" : "编辑文档"}</span></button>
      <button class="corner-tool${canOrganize ? "" : " is-disabled"}" type="button" data-action="reorganize" aria-label="重新整理" aria-disabled="${canOrganize ? "false" : "true"}" title="${canOrganize ? "重新整理" : "添加松果后可整理"}"><span class="toolbar-icon-box">${icons.leaf("toolbar-img")}</span><span class="corner-tool-label">${readOnly ? "整理中" : "重新整理"}</span></button>
    </nav>
  `;
}
function renderWarehouseDialog() {
  const dialog = state.warehouseDialog;
  if (!dialog) return "";

  const isCreate = dialog.type === "create";
  const isReorganize = dialog.type === "reorganize";
  const warehouse = isCreate ? null : hydrateWarehouseRecord(state, dialog.warehouseId);
  if (!isCreate && !warehouse) return "";

  return `
    <div class="modal-backdrop warehouse-dialog-backdrop">
      <section class="warehouse-dialog" role="dialog" aria-modal="true" aria-labelledby="warehouse-dialog-title">
        <header>
          <h3 id="warehouse-dialog-title">${isCreate ? "新建松果仓" : isReorganize ? "选择整理方式" : "删除松果仓"}</h3>
        </header>
        ${isCreate ? `
          <label for="warehouse-name-input">松果仓名称</label>
          <input id="warehouse-name-input" type="text" data-input="warehouse-name" autocomplete="off" required>
        ` : isReorganize ? `
          <fieldset class="organize-mode-options">
            <legend>如何处理暂存栏中的松果？</legend>
            <label class="organize-mode-option">
              <input type="radio" name="organize-mode" value="merge" checked>
              <span><strong>保持当前分区</strong><small>把暂存松果并入已有文档；保留现有修改和批注，仅在需要时新增分区。</small></span>
            </label>
            <label class="organize-mode-option danger-mode">
              <input type="radio" name="organize-mode" value="rebuild">
              <span><strong>全部重新整理</strong><small>使用全部松果重建文档。当前文档中的人工修改将在整理成功后被替换。</small></span>
            </label>
          </fieldset>
        ` : `
          <p>确定删除“${escapeHtml(warehouse.name)}”吗？仓内松果和整理文档会一并删除。</p>
        `}
        <footer>
          <button type="button" data-action="cancel-warehouse-dialog">取消</button>
          ${isCreate
            ? '<button class="primary-action" type="button" data-action="confirm-create-warehouse">创建</button>'
            : isReorganize
              ? '<button class="primary-action" type="button" data-action="confirm-reorganize">开始整理</button>'
              : '<button class="primary-action danger-action" type="button" data-action="confirm-delete-warehouse">确认删除</button>'}
        </footer>
      </section>
    </div>
  `;
}

function renderReviewDocument(warehouse) {
  const sections = getFilteredSections(warehouse);
  if (!sections.length) {
    return `
      <div class="empty-doc">
        ${icons.pinecone("empty-pine")}
        <h3>还没有匹配的复盘内容</h3>
        <p>换个关键词，或添加新的松果后再整理。</p>
      </div>
    `;
  }

  return sections.map((section, index) => `
    <section class="doc-section" data-section-index="${index}">
      <h3>
        <span class="${state.editMode ? "editable-field" : ""}" ${state.editMode ? `contenteditable="true" data-edit-field="heading" data-section-index="${index}"` : ""}>${index + 1}. ${escapeHtml(section.heading)}</span>
        ${icons.leaf("section-leaf")}
      </h3>
      <p class="${state.editMode ? "editable-field" : ""}" ${state.editMode ? `contenteditable="true" data-edit-field="summary" data-section-index="${index}"` : ""}>${escapeHtml(section.summary)}</p>
      ${section.bullets.length ? renderKeyBox(section, index) : ""}
    </section>
  `).join("");
}

function renderKeyBox(section, sectionIndex) {
  return `
    <div class="key-box">
      <h4>${icons.star("key-star")} 重点要点</h4>
      <ul>
        ${section.bullets.map((bullet, bulletIndex) => `
          <li>
            <span></span>
            <div class="key-item">
              <span class="${state.editMode ? "editable-field" : ""}" ${state.editMode ? `contenteditable="true" data-edit-field="bullet" data-section-index="${sectionIndex}" data-bullet-index="${bulletIndex}"` : ""}>${escapeHtml(bullet.text)}</span>
            </div>
          </li>
        `).join("")}
      </ul>
    </div>
  `;
}

function renderAddPanel(warehouse) {
  const tempCount = warehouse.pinecones.filter((pinecone) => pinecone.status === "temp").length;
  return `
    <aside class="add-panel">
      <div>
        <h3>添加松果</h3>
        <button type="button" data-action="toggle-add" aria-label="关闭">×</button>
      </div>
      <textarea data-input="pinecone" placeholder="粘贴一段经验、摘抄、灵感或聊天记录...">${escapeHtml(state.newPineconeText)}</textarea>
      <p>添加后只保存原始松果，并进入暂存栏。当前暂存栏 ${tempCount} 颗，不限数量。</p>
      <button class="primary-action" type="button" data-action="add-pinecone">添加松果</button>
    </aside>
  `;
}

function renderShelfDrawer(warehouse) {
  const query = state.shelfQuery.trim();
  const filterPinecones = (pinecones) => query
    ? pinecones.filter((pinecone) => pinecone.content.includes(query))
    : pinecones;
  const tempPinecones = filterPinecones(warehouse.pinecones.filter((pinecone) => pinecone.status === "temp"));
  const shelves = [
    {
      id: "temp",
      name: "暂存栏",
      description: "还没有整理进文档的原始松果；执行全部重新整理后，系统会统一确定章节归属。",
      pinecones: tempPinecones,
      isTemporary: true,
    },
    ...deriveShelfSections(warehouse).map((section) => ({
      ...section,
      pinecones: filterPinecones(section.pinecones),
    })),
  ];

  return `
    <aside class="shelf-drawer ${state.shelfOpen ? "open" : ""}">
      <button class="shelf-tab" type="button" data-action="toggle-shelf" aria-label="${state.shelfOpen ? "收起松果架" : "打开松果架"}">
        ${renderShelfIcon("drawer-shelf-icon")}
        ${icons.pinecone("shelf-tab-pinecone")}
        <span>松果架</span>
      </button>
      <div class="shelf-content">
        <header class="shelf-rack-header shelf-integrated-header">
          <div class="shelf-tool-row">
            <label class="shelf-search"><span>搜索松果</span>
              <input type="search" data-input="shelf-search" value="${escapeHtml(state.shelfQuery)}" placeholder="搜索松果">
            </label>
            <button type="button" class="shelf-tool-button primary" data-action="open-shelf-add" ${isActiveWarehouseOrganizing() ? "disabled" : ""}>增加松果</button>
            <button type="button" class="shelf-tool-button" data-action="toggle-shelf-management" aria-pressed="${state.shelfManaging ? "true" : "false"}" ${isActiveWarehouseOrganizing() ? "disabled" : ""}>${state.shelfManaging ? "完成管理" : "管理松果"}</button>
          </div>
        </header>
        <div class="shelf-rack-body">
          ${shelves.map((shelf) => renderShelfSection(shelf)).join("")}
        </div>
      </div>
    </aside>
  `;
}

function renderShelfSection(shelf) {
  return `
    <section class="shelf-section ${shelf.isTemporary ? "temporary-shelf-section" : ""}">
      <header class="shelf-section-head">
        <span class="shelf-section-copy">
          <strong>${escapeHtml(shelf.name)}</strong>
          <small class="shelf-count">${shelf.pinecones.length} 颗松果${shelf.isTemporary ? " · 待整理" : ""}</small>
        </span>
      </header>
      <div class="shelf-section-body">
        <p>${escapeHtml(shelf.description)}</p>
        <div class="shelf-pinecones">
          ${shelf.pinecones.length ? shelf.pinecones.map((pinecone) => renderShelfPinecone(pinecone)).join("") : '<em class="empty-shelf">这里还没有松果</em>'}
        </div>
      </div>
    </section>
  `;
}
function renderShelfPinecone(pinecone) {
  const readOnly = isActiveWarehouseOrganizing();
  return `
    <article class="shelf-pinecone ${state.shelfManaging ? "is-managing" : ""}">
      ${state.shelfManaging ? `
        <button class="pinecone-delete-button" type="button" data-action="delete-pinecone" data-pinecone-id="${pinecone.id}" aria-label="删除这颗松果" ${readOnly ? "disabled" : ""}>×</button>
        <textarea data-input="pinecone-manage" data-pinecone-id="${pinecone.id}" aria-label="编辑松果内容" ${readOnly ? "disabled" : ""}>${escapeHtml(state.pineconeDrafts[pinecone.id] ?? pinecone.content)}</textarea>
      ` : `<p>${escapeHtml(pinecone.content)}</p>`}
    </article>
  `;
}

function bindEvents() {
  document.querySelectorAll("[data-warehouse]").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.shelfManaging && !saveAllManagedPinecones()) return;
      state.activeWarehouseId = button.dataset.warehouse;
      state.query = "";
      state.addOpen = false;
      state.editMode = false;
      state.documentDraft = null;
      state.shelfManaging = false;
      state.pineconeDrafts = {};
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-action]").forEach((element) => {
    element.addEventListener("click", (event) => {
      const action = element.dataset.action;
      if (state.shelfManaging) captureManagedPineconeDrafts();
      if (action === "toggle-add") {
        state.addOpen = !state.addOpen;
        state.editMode = false;
        render();
      }
      if (action === "toggle-document-edit") {
        toggleDocumentEdit();
      }
      if (action === "toggle-shelf") {
        event.stopPropagation();
        toggleShelfDrawer();
      }
      if (action === "open-shelf-add") {
        state.addOpen = true;
        state.editMode = false;
        render();
        document.querySelector("[data-input='pinecone']")?.focus();
      }
      if (action === "toggle-shelf-management") {
        if (state.shelfManaging && !saveAllManagedPinecones()) return;
        state.shelfManaging = !state.shelfManaging;
        if (!state.shelfManaging) state.pineconeDrafts = {};
        render();
      }
      if (action === "add-pinecone") {
        addPinecone();
      }
      if (action === "reorganize") {
        requestWarehouseReorganization();
      }
      if (action === "create-warehouse") {
        createWarehouse();
      }
      if (action === "delete-warehouse") {
        event.stopPropagation();
        deleteWarehouse(element.dataset.warehouseId);
      }
      if (action === "cancel-warehouse-dialog") {
        cancelWarehouseDialog();
      }
      if (action === "confirm-create-warehouse") {
        confirmCreateWarehouse();
      }
      if (action === "confirm-delete-warehouse") {
        confirmDeleteWarehouse();
      }
      if (action === "confirm-reorganize") {
        confirmWarehouseReorganization();
      }
      if (action === "jump-section") {
        jumpToSection(Number(element.dataset.sectionIndex || 0));
      }
      if (action === "delete-pinecone") {
        if (state.shelfManaging && !saveAllManagedPinecones(element.dataset.pineconeId)) return;
        deletePinecone(element.dataset.pineconeId);
      }
    });
  });

  document.querySelectorAll("[data-edit-field]").forEach((field) => {
    field.addEventListener("input", () => updateDocumentDraft(field));
  });

  document.querySelector("[data-input='search']")?.addEventListener("input", (event) => {
    state.query = event.target.value;
    render();
  });

  document.querySelector("[data-input='pinecone']")?.addEventListener("input", (event) => {
    state.newPineconeText = event.target.value;
  });

  document.querySelector("[data-input='warehouse-name']")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      confirmCreateWarehouse();
    }
  });

  document.querySelector("[data-input='shelf-search']")?.addEventListener("input", (event) => {
    if (state.shelfManaging) captureManagedPineconeDrafts();
    state.shelfQuery = event.target.value;
    render();
  });

  document.querySelectorAll("[data-input='pinecone-manage']").forEach((input) => {
    input.addEventListener("input", () => {
      state.pineconeDrafts[input.dataset.pineconeId] = input.value;
    });
  });


  bindWarehouseDragEvents();
}

function toggleShelfDrawer() {
  state.shelfOpen = !state.shelfOpen;
  saveState();

  const drawer = document.querySelector(".shelf-drawer");
  drawer?.classList.toggle("open", state.shelfOpen);

  const label = state.shelfOpen ? "收起松果架" : "打开松果架";
  drawer?.querySelectorAll("[data-action='toggle-shelf']").forEach((control) => {
    control.setAttribute("aria-label", label);
  });

}

function jumpToSection(index) {
  const target = document.querySelector(`.doc-section[data-section-index="${index}"]`);
  const scroller = document.querySelector(".review-doc");
  if (!target || !scroller) return;
  scroller.scrollTo({ top: target.offsetTop, behavior: "smooth" });
  document.querySelectorAll(".toc button").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.sectionIndex || -1) === index);
    button.innerHTML = button.innerHTML.replace(/<b><\/b>/g, "");
    if (Number(button.dataset.sectionIndex || -1) === index && !button.querySelector("b")) {
      button.insertAdjacentHTML("beforeend", "<b></b>");
    }
  });
}
function bindWarehouseDragEvents() {
  document.querySelectorAll("[data-warehouse-card]").forEach((card) => {
    card.addEventListener("pointerdown", (event) => {
      if (state.organizingWarehouseId) return;
      if (touchWarehouseDrag) {
        if (event.pointerType === "touch") {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      warehouseDragStartedFromButton = Boolean(event.target.closest("button"));
      if (warehouseDragStartedFromButton || event.pointerType !== "touch") return;

      touchWarehouseDrag = {
        pointerId: event.pointerId,
        sourceId: card.dataset.warehouseCard,
        startX: event.clientX,
        startY: event.clientY,
        clientX: event.clientX,
        clientY: event.clientY,
        targetId: "",
        placement: "before",
        active: false,
        activationTimer: window.setTimeout(() => {
          activateTouchWarehouseDrag(card, event.pointerId);
        }, TOUCH_DRAG_HOLD_MS),
      };
    }, { capture: true });

    card.addEventListener("dragstart", (event) => {
      if (state.organizingWarehouseId) {
        event.preventDefault();
        return;
      }
      if (warehouseDragStartedFromButton) {
        event.preventDefault();
        return;
      }
      if (touchWarehouseDrag) {
        event.preventDefault();
        return;
      }
      draggedWarehouseId = card.dataset.warehouseCard;
      card.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", draggedWarehouseId);
    });

    card.addEventListener("pointermove", (event) => {
      if (!touchWarehouseDrag || event.pointerId !== touchWarehouseDrag.pointerId || event.pointerType !== "touch") return;
      touchWarehouseDrag.clientX = event.clientX;
      touchWarehouseDrag.clientY = event.clientY;

      if (!touchWarehouseDrag.active) {
        const distance = Math.hypot(
          event.clientX - touchWarehouseDrag.startX,
          event.clientY - touchWarehouseDrag.startY,
        );
        if (distance > TOUCH_DRAG_MOVE_THRESHOLD) {
          clearWarehouseDragState();
        }
        return;
      }

      event.preventDefault();
      updateTouchWarehouseDropTarget(event.clientX, event.clientY);
      startWarehouseAutoScroll();
    });

    card.addEventListener("pointerup", (event) => {
      warehouseDragStartedFromButton = false;
      finishTouchWarehouseDrag(card, event, true);
    });

    card.addEventListener("pointercancel", (event) => {
      warehouseDragStartedFromButton = false;
      finishTouchWarehouseDrag(card, event, false);
    });

    card.addEventListener("lostpointercapture", (event) => {
      if (touchWarehouseDrag?.active && event.pointerId === touchWarehouseDrag.pointerId) {
        clearWarehouseDragState();
      }
    });

    card.addEventListener("dragover", (event) => {
      if (!draggedWarehouseId || draggedWarehouseId === card.dataset.warehouseCard) return;
      event.preventDefault();
      clearWarehouseDropIndicators();
      const rect = card.getBoundingClientRect();
      card.classList.add(event.clientY < rect.top + rect.height / 2 ? "drop-before" : "drop-after");
    });

    card.addEventListener("drop", (event) => {
      event.preventDefault();
      const placement = card.classList.contains("drop-after") ? "after" : "before";
      const next = reorderWarehouseRecords(state, draggedWarehouseId, card.dataset.warehouseCard, placement);
      if (next !== state) {
        state = next;
        saveState();
        render();
      }
      clearWarehouseDragState();
    });

    card.addEventListener("dragend", clearWarehouseDragState);
  });
}

function activateTouchWarehouseDrag(card, pointerId) {
  if (!touchWarehouseDrag || touchWarehouseDrag.pointerId !== pointerId) return;
  if (!card.isConnected) {
    clearWarehouseDragState();
    return;
  }

  touchWarehouseDrag.active = true;
  touchWarehouseDrag.activationTimer = 0;
  draggedWarehouseId = touchWarehouseDrag.sourceId;
  card.classList.add("dragging");
  card.setPointerCapture(pointerId);
  updateTouchWarehouseDropTarget(touchWarehouseDrag.clientX, touchWarehouseDrag.clientY);
  startWarehouseAutoScroll();
}

function preventActiveWarehouseTouchScroll(event) {
  if (touchWarehouseDrag?.active) {
    event.preventDefault();
  }
}

function updateTouchWarehouseDropTarget(clientX, clientY) {
  if (!touchWarehouseDrag?.active) return;

  clearWarehouseDropIndicators();
  const targetCard = document.elementFromPoint(clientX, clientY)?.closest("[data-warehouse-card]");
  touchWarehouseDrag.targetId = "";
  if (!targetCard || targetCard.dataset.warehouseCard === touchWarehouseDrag.sourceId) return;

  const rect = targetCard.getBoundingClientRect();
  touchWarehouseDrag.targetId = targetCard.dataset.warehouseCard;
  touchWarehouseDrag.placement = clientY < rect.top + rect.height / 2 ? "before" : "after";
  targetCard.classList.add(`drop-${touchWarehouseDrag.placement}`);
}

function startWarehouseAutoScroll() {
  if (warehouseAutoScrollFrame || !touchWarehouseDrag?.active) return;
  warehouseAutoScrollFrame = requestAnimationFrame(runWarehouseAutoScroll);
}

function runWarehouseAutoScroll() {
  warehouseAutoScrollFrame = 0;
  if (!touchWarehouseDrag?.active) return;

  const { clientX, clientY } = touchWarehouseDrag;
  const warehouseList = document.querySelector(".warehouse-list");
  let didScrollX = false;
  let didScrollY = false;

  if (warehouseList) {
    const rect = warehouseList.getBoundingClientRect();
    const deltaX = getWarehouseAutoScrollDelta(clientX, rect.left, rect.right);
    const deltaY = getWarehouseAutoScrollDelta(clientY, rect.top, rect.bottom);
    if (deltaX) {
      const previousScrollLeft = warehouseList.scrollLeft;
      warehouseList.scrollLeft += deltaX;
      didScrollX = warehouseList.scrollLeft !== previousScrollLeft;
    }
    if (deltaY) {
      const previousScrollTop = warehouseList.scrollTop;
      warehouseList.scrollTop += deltaY;
      didScrollY = warehouseList.scrollTop !== previousScrollTop;
    }
  }

  if (!didScrollX || !didScrollY) {
    const deltaX = didScrollX ? 0 : getWarehouseAutoScrollDelta(clientX, 0, window.innerWidth);
    const deltaY = didScrollY ? 0 : getWarehouseAutoScrollDelta(clientY, 0, window.innerHeight);
    if (deltaX || deltaY) {
      const previousScrollX = window.scrollX;
      const previousScrollY = window.scrollY;
      window.scrollBy(deltaX, deltaY);
      didScrollX = didScrollX || window.scrollX !== previousScrollX;
      didScrollY = didScrollY || window.scrollY !== previousScrollY;
    }
  }

  updateTouchWarehouseDropTarget(clientX, clientY);
  if (didScrollX || didScrollY) startWarehouseAutoScroll();
}

function getWarehouseAutoScrollDelta(coordinate, start, end) {
  if (coordinate < start + WAREHOUSE_AUTO_SCROLL_EDGE) return -WAREHOUSE_AUTO_SCROLL_SPEED;
  if (coordinate > end - WAREHOUSE_AUTO_SCROLL_EDGE) return WAREHOUSE_AUTO_SCROLL_SPEED;
  return 0;
}

function stopWarehouseAutoScroll() {
  if (!warehouseAutoScrollFrame) return;
  cancelAnimationFrame(warehouseAutoScrollFrame);
  warehouseAutoScrollFrame = 0;
}

function finishTouchWarehouseDrag(card, event, shouldReorder) {
  if (!touchWarehouseDrag || event.pointerId !== touchWarehouseDrag.pointerId || event.pointerType !== "touch") return;

  const { sourceId, targetId, placement, active } = touchWarehouseDrag;
  if (active && card.hasPointerCapture(event.pointerId)) {
    card.releasePointerCapture(event.pointerId);
  }
  clearWarehouseDragState();

  if (!shouldReorder || !active || !targetId) return;
  const next = reorderWarehouseRecords(state, sourceId, targetId, placement);
  if (next !== state) {
    state = next;
    saveState();
    render();
  }
}

function clearWarehouseDropIndicators() {
  document.querySelectorAll(".drop-before, .drop-after").forEach((card) => {
    card.classList.remove("drop-before", "drop-after");
  });
}

function clearWarehouseDragState() {
  if (touchWarehouseDrag?.activationTimer) {
    window.clearTimeout(touchWarehouseDrag.activationTimer);
  }
  stopWarehouseAutoScroll();
  draggedWarehouseId = "";
  warehouseDragStartedFromButton = false;
  touchWarehouseDrag = null;
  document.querySelectorAll(".warehouse-card").forEach((card) => {
    card.classList.remove("dragging", "drop-before", "drop-after");
  });
}

function toggleDocumentEdit() {
  if (isActiveWarehouseOrganizing()) return;
  if (state.editMode) {
    saveDocumentEdits();
    return;
  }

  state.editMode = true;
  state.documentDraft = hydrateWarehouseRecord(state, state.activeWarehouseId);
  state.addOpen = false;
  render();
}

function updateDocumentDraft(field) {
  if (!state.documentDraft) return;
  const value = field.textContent.trim().replace(/^\d+\.\s*/, "");
  state.documentDraft = applyDocumentEdit(state.documentDraft, {
    field: field.dataset.editField,
    sectionIndex: Number(field.dataset.sectionIndex),
    bulletIndex: Number(field.dataset.bulletIndex),
  }, value);
  state.documentDraft.updatedAt = nowText();
}

function saveDocumentEdits() {
  if (state.documentDraft) commitWarehouse(state.documentDraft);
  state.editMode = false;
  state.documentDraft = null;
  saveState();
  showToast("复盘文档已保存。");
}

function addPinecone() {
  if (isActiveWarehouseOrganizing()) return;
  const warehouse = getActiveWarehouse();
  const content = state.newPineconeText.trim();
  if (!content) {
    showToast("先放入一段松果内容。");
    return;
  }

  warehouse.pinecones.unshift({
    id: uid("pinecone"),
    content,
    status: "temp",
    shelfId: null,
    createdAt: nowText().replace(" 更新", ""),
  });

  warehouse.updatedAt = nowText();
  state.newPineconeText = "";
  state.addOpen = false;
  commitWarehouse(warehouse);
  saveState();
  showToast("已放入暂存栏。");
}

function deletePinecone(pineconeId) {
  if (isActiveWarehouseOrganizing()) return;
  const warehouse = getActiveWarehouse();
  const pinecone = warehouse.pinecones.find((item) => item.id === pineconeId);
  if (!pinecone) return;

  warehouse.pinecones = warehouse.pinecones.filter((item) => item.id !== pineconeId);
  warehouse.updatedAt = nowText();
  commitWarehouse(warehouse);
  saveState();
  showToast("松果已删除。");
}

function saveAllManagedPinecones(excludedPineconeId = "") {
  if (isActiveWarehouseOrganizing()) return false;
  const warehouse = getActiveWarehouse();
  captureManagedPineconeDrafts();
  const edits = Object.entries(state.pineconeDrafts)
    .filter(([id]) => id !== excludedPineconeId)
    .map(([id, content]) => ({ id, content }));
  const result = applyPineconeEdits(warehouse, edits);
  if (result.invalidIds.length) {
    showToast("松果内容不能为空。");
    return false;
  }
  result.warehouse.updatedAt = nowText();
  commitWarehouse(result.warehouse);
  state.pineconeDrafts = {};
  saveState();
  return true;
}

function captureManagedPineconeDrafts() {
  document.querySelectorAll("[data-input='pinecone-manage']").forEach((input) => {
    state.pineconeDrafts[input.dataset.pineconeId] = input.value;
  });
}

function deleteWarehouse(warehouseId) {
  if (isWarehouseReadOnly(state.organizingWarehouseId, warehouseId)) return;
  const warehouse = hydrateWarehouseRecord(state, warehouseId);
  if (!warehouse) return;

  state.warehouseDialog = { type: "delete", warehouseId };
  render();
}

function confirmDeleteWarehouse() {
  if (state.warehouseDialog?.type !== "delete") return;
  const warehouseId = state.warehouseDialog.warehouseId;

  const result = removeWarehouseRecord(state, warehouseId);
  if (!result.removed) return;
  state = result.state;
  resetWarehouseTransientState();
  saveState();
  render();
  showToast("松鼠仓已删除。");
}

function resetWarehouseTransientState() {
  state.query = "";
  state.addOpen = false;
  state.editMode = false;
  state.documentDraft = null;
  state.shelfOpen = false;
  state.shelfManaging = false;
  state.pineconeDrafts = {};
  state.warehouseDialog = null;
}

function createWarehouse() {
  state.warehouseDialog = { type: "create" };
  render();
  document.querySelector("[data-input='warehouse-name']")?.focus();
}

function cancelWarehouseDialog() {
  state.warehouseDialog = null;
  render();
}

function confirmCreateWarehouse() {
  if (state.warehouseDialog?.type !== "create") return;
  const input = document.querySelector("[data-input='warehouse-name']");
  const name = input?.value.trim();
  if (!name) {
    input?.setCustomValidity("请输入松果仓名称");
    input?.reportValidity();
    return;
  }
  input.setCustomValidity("");

  const id = uid("warehouse");
  const record = createEmptyWarehouseRecord(id, name, nowText());
  state = persistWarehouseRecord(state, {
    ...record.warehouse,
    reviewDocument: record.document,
    shelves: record.shelves,
    pinecones: record.pinecones,
  });
  state.activeWarehouseId = id;
  state.warehouseDialog = null;
  saveState();
  render();
  showToast("松果仓已创建。");
}

async function organizeWarehouse(warehouseId, mode) {
  const warehouse = hydrateWarehouseRecord(state, warehouseId);
  if (!warehouse) throw new Error("WAREHOUSE_NOT_FOUND");
  const result = USE_API_ORGANIZER
    ? await organizeWarehouseWithApi(warehouse, mode)
    : organizeWarehouseWithMock(warehouse, mode);

  Object.assign(warehouse, result);
  warehouse.updatedAt = nowText();
  commitWarehouse(warehouse);
  saveState();
  showToast(mode === "merge" ? "暂存松果已并入当前文档。" : "已全部重新整理，复盘文档已更新。");
}

async function organizeWarehouseWithApi(_warehouse, _mode) {
  throw new Error("API organizer is reserved. Replace this function with an OpenAI API call.");
}

function organizeWarehouseWithMock(warehouse, mode) {
  return organizeWarehouseLocally(warehouse, { mode });
}

function requestWarehouseReorganization() {
  if (state.shelfManaging && !saveAllManagedPinecones()) return;
  const warehouse = getActiveWarehouse();
  if (!canStartWarehouseOrganization(state.organizingWarehouseId, warehouse)) {
    showToast(state.organizingWarehouseId ? "已有仓库正在整理，请等待当前任务完成。" : "暂存栏还没有松果，添加后即可整理。");
    return;
  }
  state.warehouseDialog = { type: "reorganize", warehouseId: warehouse.id };
  render();
}

async function confirmWarehouseReorganization() {
  if (state.warehouseDialog?.type !== "reorganize") return;
  const warehouseId = state.warehouseDialog.warehouseId;
  const warehouse = hydrateWarehouseRecord(state, warehouseId);
  if (!canStartWarehouseOrganization(state.organizingWarehouseId, warehouse)) return;
  const mode = document.querySelector('input[name="organize-mode"]:checked')?.value || "merge";
  if (state.documentDraft?.id === warehouseId) {
    commitWarehouse(state.documentDraft);
    saveState();
  }
  state.warehouseDialog = null;
  state.organizingWarehouseId = warehouseId;
  state.editMode = false;
  state.documentDraft = null;
  state.addOpen = false;
  state.shelfManaging = false;
  render();
  try {
    await organizeWarehouse(warehouseId, mode);
  } catch {
    showToast("整理失败，当前文档和松果架保持原样，请稍后重试。");
  } finally {
    if (state.organizingWarehouseId === warehouseId) state.organizingWarehouseId = null;
    render();
  }
}

function buildReviewDocument(title, sections) {
  return { title, sections };
}

function getFilteredSections(warehouse) {
  const query = state.query.trim();
  if (!query) return warehouse.reviewDocument.sections;
  return warehouse.reviewDocument.sections.filter((section) =>
    [section.heading, section.summary, ...section.bullets.map((bullet) => bullet.text)].some((text) => text.includes(query)),
  );
}

function showToast(message) {
  state.toast = message;
  render();
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    state.toast = "";
    renderToast();
  }, 2200);
}

function renderToast() {
  toast.textContent = state.toast;
  toast.classList.toggle("show", Boolean(state.toast));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
